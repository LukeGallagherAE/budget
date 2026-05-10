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
const pdfParse = require('pdf-parse');

const sleep = ms => new Promise(r => setTimeout(r, ms));

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
    since.setFullYear(since.getFullYear() - 1);

    // Run keyword searches in parallel, merge UIDs
    const keywords = ['invoice', 'receipt', 'payment', 'bill', 'renewal', 'subscription'];
    const uidArrays = await Promise.all(
      keywords.map(kw => client.search({ since, subject: kw }).catch(() => []))
    );
    const allUids = [...new Set(uidArrays.flat())].sort((a, b) => a - b);
    const targetUids = allUids.slice(-300);
    if (!targetUids.length) return [];

    for await (const msg of client.fetch(targetUids, { source: true })) {
      try {
        const parsed = await simpleParser(msg.source);
        const plain = (parsed.text || '').trim();
        const stripped = (parsed.html || '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim();
        const bodyText = (plain || stripped).slice(0, 2500);

        // Parse any PDF attachments and append their text
        const attachmentMeta = [];
        const pdfTexts = [];
        for (const att of (parsed.attachments || [])) {
          const isPdf = att.contentType === 'application/pdf'
            || (att.filename || '').toLowerCase().endsWith('.pdf');
          if (!isPdf) continue;
          attachmentMeta.push({ name: att.filename || 'attachment.pdf', size: att.size || 0 });
          try {
            const pdfData = await pdfParse(att.content);
            pdfTexts.push(pdfData.text.slice(0, 2000));
          } catch { /* skip unreadable PDFs */ }
        }

        const fullBody = pdfTexts.length
          ? bodyText + '\n\n[PDF ATTACHMENT]\n' + pdfTexts.join('\n\n---\n\n')
          : bodyText;

        emails.push({
          subject: parsed.subject || '',
          from: parsed.from?.text || '',
          date: parsed.date || new Date(),
          body: fullBody.slice(0, 5000),
          attachments: attachmentMeta,
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
  // Support both default and named export styles across SDK versions
  const AnthropicClient = Anthropic.default || Anthropic;
  const anthropic = new AnthropicClient({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Process sequentially with a delay between batches to stay under the
  // 50k tokens/minute rate limit. Takes longer but won't hit 429 errors.
  const BATCH = 10;
  const DELAY_MS = 4000; // 4 s gap — well under rate limit
  const today = new Date().toISOString().split('T')[0];
  const results = [];
  const errors = [];

  const chunks = [];
  for (let i = 0; i < emails.length; i += BATCH) chunks.push(emails.slice(i, i + BATCH));

  for (let i = 0; i < chunks.length; i++) {
    if (i > 0) await sleep(DELAY_MS);
    const batch = chunks[i];

    const formatted = batch.map((e, j) => {
      const dateStr = e.date instanceof Date
        ? e.date.toISOString().split('T')[0]
        : String(e.date).split('T')[0];
      return '=== EMAIL ' + j + ' ===\nFrom: ' + e.from + '\nSubject: ' + e.subject + '\nDate: ' + dateStr + '\n\n' + e.body;
    }).join('\n\n---\n\n');

    const prompt = 'Today is ' + today + '. Analyse these emails and extract invoice/payment data.\n\n' +
      'Return ONLY a valid JSON array — no markdown fences, no extra text:\n' +
      '[{\n' +
      '  "index": <0-based email number>,\n' +
      '  "merchant": "<short company name e.g. Netflix, Telstra, AWS>",\n' +
      '  "amount": <number>,\n' +
      '  "currency": "<AUD|USD|GBP|EUR>",\n' +
      '  "due_date": "<YYYY-MM-DD or null>",\n' +
      '  "paid_date": "<YYYY-MM-DD or null>",\n' +
      '  "invoice_number": "<string or null>",\n' +
      '  "status": "<paid|due|upcoming>",\n' +
      '  "category": "<Subscriptions|Utilities|Insurance|Food|Transport|Health|Entertainment|Other>",\n' +
      '  "confidence": <60-99>\n' +
      '}]\n\n' +
      'Rules:\n' +
      '- "paid"     = payment confirmed/processed\n' +
      '- "due"      = payment due within 14 days of today\n' +
      '- "upcoming" = payment due more than 14 days away\n' +
      '- Omit non-invoice emails (newsletters, promotions without real amounts)\n' +
      '- Only include confidence >= 60\n' +
      '- Amounts must come from the email text, not guessed\n' +
      '- Return [] if none qualify\n\n' +
      'Emails:\n' + formatted;

    try {
      const response = await anthropic.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
      });

      const raw = response.content[0].text.trim();
      const jsonStr = raw.match(/\[[\s\S]*\]/)?.[0] || '[]';
      const extracted = JSON.parse(jsonStr)
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
          email_date: (() => {
            const d = (batch[item.index] || {}).date;
            return d instanceof Date ? d.toISOString().split('T')[0] : null;
          })(),
          attachments: (batch[item.index] || {}).attachments || [],
          email_body: ((batch[item.index] || {}).body || '').slice(0, 600),
        }));
      results.push(...extracted);
    } catch (e) {
      const msg = e.status
        ? ('Claude API error ' + e.status + ': ' + (e.error?.error?.message || e.message))
        : e.message;
      console.error('Batch extraction error:', msg);
      errors.push(msg);
    }
  }

  return { invoices: results, errors };
}

function deduplicateInvoices(invoices) {
  // Group by normalised merchant + amount
  const groups = {};
  for (const inv of invoices) {
    const key = inv.merchant.toLowerCase().trim() + '|' + inv.amount.toFixed(2);
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

    // Merge unique attachments across all email occurrences
    const allAtts = items.flatMap(it => it.attachments || []);
    const seenAtts = new Map();
    for (const a of allAtts) if (!seenAtts.has(a.name)) seenAtts.set(a.name, a);

    deduped.push({
      ...primary,
      occurrences: items.length,
      has_paid_version: paid.length > 0 && primary.status !== 'paid',
      frequency: inferFrequency(items),
      attachments: [...seenAtts.values()],
      // Keep body from primary (most relevant: due/upcoming preferred over paid)
      email_body: primary.email_body || '',
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

  const emails = await fetchInvoiceEmails();
  if (!emails.length) return { invoices: [], emails_scanned: 0, errors: [] };

  const { invoices: raw, errors } = await extractInvoices(emails);

  // If ALL batches errored and we got nothing, surface the first error
  if (raw.length === 0 && errors.length > 0 && errors.length === Math.ceil(emails.length / 10)) {
    throw new Error('Claude extraction failed: ' + errors[0]);
  }

  const invoices = deduplicateInvoices(raw);
  return { invoices, emails_scanned: emails.length, errors };
}

module.exports = { scanInvoiceEmails };
