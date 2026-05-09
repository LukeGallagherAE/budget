/**
 * Gmail invoice scanner.
 * Requires env vars:
 *   GMAIL_USER          — your Gmail address
 *   GMAIL_APP_PASSWORD  — 16-char Google app password
 *   ANTHROPIC_API_KEY   — Claude API key
 */

const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const Anthropic = require('@anthropic-ai/sdk');

function classifyFrequency(avgDays) {
  if (avgDays <= 1.5)  return 'daily';
  if (avgDays <= 8)    return 'weekly';
  if (avgDays <= 16)   return 'biweekly';
  if (avgDays <= 35)   return 'monthly';
  if (avgDays <= 100)  return 'quarterly';
  if (avgDays <= 380)  return 'yearly';
  return 'custom';
}

function inferFrequency(items) {
  const dates = items
    .map(i => i.due_date || i.paid_date || i.email_date)
    .filter(Boolean).map(d => new Date(d)).filter(d => !isNaN(d))
    .sort((a, b) => a - b);
  if (dates.length < 2) return null;
  const intervals = [];
  for (let i = 1; i < dates.length; i++) {
    const diff = (dates[i] - dates[i-1]) / 86400000;
    if (diff > 0) intervals.push(diff);
  }
  if (!intervals.length) return null;
  return classifyFrequency(intervals.reduce((a,b) => a+b) / intervals.length);
}

async function fetchInvoiceEmails() {
  const client = new ImapFlow({
    host: 'imap.gmail.com', port: 993, secure: true,
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
    logger: false,
  });

  await client.connect();
  const lock = await client.getMailboxLock('INBOX');
  const emails = [];

  try {
    const since = new Date();
    since.setDate(since.getDate() - 180);

    // Run keyword searches in parallel, merge UIDs
    const keywords = ['invoice', 'receipt', 'payment', 'bill', 'renewal', 'subscription'];
    const uidArrays = await Promise.all(
      keywords.map(kw => client.search({ since, subject: kw }).catch(() => []))
    );
    const allUids = [...new Set(uidArrays.flat())].sort((a, b) => a - b);
    const targetUids = allUids.slice(-120);
    if (!targetUids.length) return [];

    for await (const msg of client.fetch(targetUids, { source: true })) {
      try {
        const parsed = await simpleParser(msg.source);
        const plain = (parsed.text || '').trim();
        const stripped = (parsed.html || '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim();
        emails.push({
          subject: parsed.subject || '',
          from: parsed.from?.text || '',
          date: parsed.date || new Date(),
          body: (plain || stripped).slice(0, 3000),
        });
      } catch { /* skip malformed */ }
    }
  } finally {
    lock.release();
    await client.logout();
  }
  return emails;
}

async function extractInvoices(emails) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const BATCH = 12;
  const CONCURRENCY = 3;
  const today = new Date().toISOString().split('T')[0];
  const results = [];

  const chunks = [];
  for (let i = 0; i < emails.length; i += BATCH) chunks.push(emails.slice(i, i + BATCH));

  for (let i = 0; i < chunks.length; i += CONCURRENCY) {
    const window = chunks.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(window.map(async (batch) => {
      const formatted = batch.map((e, j) =>
        `=== EMAIL ${j} ===\nFrom: ${e.from}\nSubject: ${e.subject}\nDate: ${e.date.toISOString().split('T')[0]}\n\n${e.body}`
      ).join('\n\n---\n\n');

      try {
        const response = await anthropic.messages.create({
          model: 'claude-haiku-4-5',
          max_tokens: 2048,
          messages: [{
            role: 'user',
            content: `Today is ${today}. Analyse these emails and extract invoice/payment data.

Return ONLY a valid JSON array — no markdown fences, no extra text:
[{
  "index": <0-based email number>,
  "merchant": "<short company name e.g. Netflix, Telstra, AWS>",
  "amount": <number>,
  "currency": "<AUD|USD|GBP|EUR>",
  "due_date": "<YYYY-MM-DD or null>",
  "paid_date": "<YYYY-MM-DD or null>",
  "invoice_number": "<string or null>",
  "status": "<paid|due|upcoming>",
  "category": "<Subscriptions|Utilities|Insurance|Food|Transport|Health|Housing|Entertainment|Other>",
  "confidence": <60-99>
}]

Rules:
- "paid"     = payment confirmed/processed
- "due"      = payment due within 14 days of today
- "upcoming" = payment due more than 14 days away
- Omit non-invoice emails (newsletters, promotions without real amounts)
- Only include confidence >= 60
- Amounts must come from the email text, not guessed
- Return [] if none qualify

Emails:
${formatted}`,
          }],
        });

        const raw = response.content[0].text.trim();
        const jsonStr = raw.match(/\[[\s\S]*\]/)?.[0] || '[]';
        return JSON.parse(jsonStr)
          .filter(item => item.confidence >= 60 && item.amount > 0)
          .map(item => ({
            merchant: item.merchant,
            amount: parseFloat(item.amount),
            currency: item.currency || 'AUD',
            due_date: item.due_date || null,
            paid_date: item.paid_date || null,
            invoice_number: item.invoice_number || null,
            status: item.status || 'upcoming',
            category: item.category || 'Other',
            confidence: item.confidence,
            from: (batch[item.index] || {}).from || '',
            subject: (batch[item.index] || {}).subject || '',
            email_date: (batch[item.index] || {}).date?.toISOString?.()?.split('T')[0] || null,
          }));
      } catch (e) {
        console.error('Batch extraction error:', e.message);
        return [];
      }
    }));
    results.push(...batchResults.flat());
  }
  return results;
}

function deduplicateInvoices(invoices) {
  // Group by normalised merchant + amount
  const groups = {};
  for (const inv of invoices) {
    const key = `${inv.merchant.toLowerCase().trim()}|${inv.amount.toFixed(2)}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(inv);
  }

  const deduped = [];
  for (const items of Object.values(groups)) {
    const paid     = items.filter(i => i.status === 'paid');
    const due      = items.filter(i => i.status === 'due');
    const upcoming = items.filter(i => i.status === 'upcoming');
    const unpaid   = due.length ? due : upcoming;
    const primary  = unpaid.length ? unpaid[0] : paid[0];

    deduped.push({
      ...primary,
      occurrences: items.length,
      has_paid_version: paid.length > 0 && primary.status !== 'paid',
      frequency: inferFrequency(items),
    });
  }

  const order = { due: 0, upcoming: 1, paid: 2 };
  return deduped.sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3));
}

async function scanInvoiceEmails() {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD)
    throw new Error('GMAIL_NOT_CONFIGURED');
  if (!process.env.ANTHROPIC_API_KEY)
    throw new Error('ANTHROPIC_KEY_MISSING');

  const emails   = await fetchInvoiceEmails();
  if (!emails.length) return { invoices: [], emails_scanned: 0 };

  const raw      = await extractInvoices(emails);
  const invoices = deduplicateInvoices(raw);
  return { invoices, emails_scanned: emails.length };
}

module.exports = { scanInvoiceEmails };
