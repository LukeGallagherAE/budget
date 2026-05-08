/**
 * Analyzes a bank statement (CSV or PDF) and detects recurring transactions.
 */

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const header = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, '').toLowerCase());
  const dateCol = header.findIndex(h => /date|time|posted|transaction/i.test(h));
  const descCol = header.findIndex(h => /desc|memo|name|payee|merchant|narr/i.test(h));
  const amountCol = header.findIndex(h => /amount|debit|credit|sum|value/i.test(h));
  if (dateCol === -1 || descCol === -1 || amountCol === -1) {
    return lines.slice(1).map(line => {
      const cols = splitCSVLine(line);
      return { date: cols[0]?.trim(), description: cols[1]?.trim(), amount: parseAmount(cols[2]) };
    }).filter(r => r.date && r.description && r.amount !== null);
  }
  return lines.slice(1).map(line => {
    const cols = splitCSVLine(line);
    return {
      date: cols[dateCol]?.trim().replace(/^"|"$/g, ''),
      description: cols[descCol]?.trim().replace(/^"|"$/g, ''),
      amount: parseAmount(cols[amountCol]),
    };
  }).filter(r => r.date && r.description && r.amount !== null);
}

function splitCSVLine(line) {
  const result = [];
  let cur = '', inQuotes = false;
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes; }
    else if (ch === ',' && !inQuotes) { result.push(cur); cur = ''; }
    else { cur += ch; }
  }
  result.push(cur);
  return result;
}

function parseAmount(str) {
  if (!str) return null;
  const cleaned = str.replace(/[^0-9.\-]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : Math.abs(num);
}

function normalizeDate(str) {
  if (!str) return null;
  // ISO: YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    const d = new Date(str);
    if (!isNaN(d)) return d;
  }
  // DD/MM/YYYY or MM/DD/YYYY — try DD/MM first (Australian), fallback swap if invalid
  const m1 = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m1) {
    const [, a, b, yr] = m1;
    // Try DD/MM/YYYY first
    const d1 = new Date(`${yr}-${b.padStart(2,'0')}-${a.padStart(2,'0')}`);
    if (!isNaN(d1)) return d1;
    // Fallback: MM/DD/YYYY
    const d2 = new Date(`${yr}-${a.padStart(2,'0')}-${b.padStart(2,'0')}`);
    if (!isNaN(d2)) return d2;
  }
  // DD/MM/YY
  const m2 = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})$/);
  if (m2) {
    const yr = parseInt(m2[3]) + 2000;
    const d = new Date(`${yr}-${m2[2].padStart(2,'0')}-${m2[1].padStart(2,'0')}`);
    if (!isNaN(d)) return d;
  }
  // DD Mon YYYY or Mon DD YYYY
  const d = new Date(str);
  return isNaN(d) ? null : d;
}

function cleanDescription(desc) {
  return desc
    .replace(/\s+\d{6,}/g, '')
    .replace(/\s+#\w+/g, '')
    .replace(/\s+REF\w*/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .toUpperCase();
}

function guessCategory(name) {
  const n = name.toLowerCase();
  if (/netflix|spotify|hulu|disney|apple|amazon prime|youtube|hbo|paramount|peacock|sling|tidal|stan|binge/.test(n)) return 'Subscriptions';
  if (/gym|fitness|planet fitness|anytime fitness|crossfit|health fund|medibank|bupa|ahm/.test(n)) return 'Health';
  if (/rent|mortgage|landlord|property|real estate/.test(n)) return 'Housing';
  if (/electric|energy|gas|water|sewage|internet|telstra|optus|tpg|vodafone|aussie broadband|phone|broadband|origin|agl/.test(n)) return 'Utilities';
  if (/insurance|geico|progressive|allstate|nrma|racv|aami|budget direct|real insurance/.test(n)) return 'Insurance';
  if (/uber|lyft|transit|metro|bus|parking|fuel|petrol|bp|shell|caltex|ampol|7-eleven/.test(n)) return 'Transport';
  if (/grocery|woolworths|coles|aldi|iga|costco|whole foods|trader joe|kroger|safeway|food/.test(n)) return 'Food';
  return 'Other';
}

function classifyFrequency(avgDays) {
  if (avgDays <= 1.5) return 'daily';
  if (avgDays <= 8) return 'weekly';
  if (avgDays <= 16) return 'biweekly';
  if (avgDays <= 35) return 'monthly';
  if (avgDays <= 100) return 'quarterly';
  if (avgDays <= 380) return 'yearly';
  return 'custom';
}

function stddev(arr) {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  return Math.sqrt(arr.reduce((s, x) => s + (x - mean) ** 2, 0) / arr.length);
}

function analyzeRecurring(transactions) {
  const groups = {};
  for (const tx of transactions) {
    const key = cleanDescription(tx.description);
    if (!groups[key]) groups[key] = [];
    groups[key].push(tx);
  }

  const recurring = [];

  for (const [key, txs] of Object.entries(groups)) {
    if (txs.length < 2) continue;

    const dated = txs
      .map(t => ({ ...t, parsedDate: normalizeDate(t.date) }))
      .filter(t => t.parsedDate)
      .sort((a, b) => a.parsedDate - b.parsedDate);

    if (dated.length < 2) continue;

    const intervals = [];
    for (let i = 1; i < dated.length; i++) {
      const diff = Math.round((dated[i].parsedDate - dated[i - 1].parsedDate) / 86400000);
      if (diff > 0) intervals.push(diff);
    }
    if (intervals.length === 0) continue;

    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const sd = stddev(intervals);

    // Looser threshold for longer intervals (quarterly/annual vary more)
    const threshold = Math.max(7, avgInterval * 0.45);
    if (sd > threshold) continue;

    const amounts = dated.map(t => t.amount).filter(Boolean);
    const avgAmount = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const amountVariance = Math.max(...amounts) - Math.min(...amounts);

    // Allow 30% variance in amounts (some bills vary slightly)
    if (amountVariance > avgAmount * 0.30 && amountVariance > 10) continue;

    const frequency = classifyFrequency(avgInterval);
    const lastDate = dated[dated.length - 1].parsedDate;
    const lastDateStr = lastDate.toISOString().split('T')[0];

    let confidence = 50;
    if (dated.length >= 3) confidence += 20;
    if (dated.length >= 5) confidence += 10;
    if (sd < avgInterval * 0.1) confidence += 15;
    if (amountVariance < 1) confidence += 5;
    confidence = Math.min(99, confidence);

    recurring.push({
      name: key.charAt(0) + key.slice(1).toLowerCase(),
      amount: parseFloat(avgAmount.toFixed(2)),
      frequency,
      interval_days: frequency === 'custom' ? Math.round(avgInterval) : null,
      occurrences: dated.length,
      last_date: lastDateStr,
      confidence,
      category: guessCategory(key),
    });
  }

  return recurring.sort((a, b) => b.confidence - a.confidence);
}

function parsePDF(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  const transactions = [];
  const DATE_RE = /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}[\/\-]\d{2}[\/\-]\d{2}|\d{1,2}\s+[A-Z][a-z]{2}\s+\d{4}|[A-Z][a-z]{2}\s+\d{1,2},?\s+\d{4})/;
  const AMOUNT_RE = /(?<!\d)(\d{1,3}(?:,\d{3})*\.\d{2})(?!\d)/g;
  const NOISE_RE = /\b(CR|DR|CREDIT|DEBIT|OPENING|CLOSING|BALANCE|TOTAL|BROUGHT|FORWARD|CARRIED|OD)\b/gi;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const dateMatch = line.match(DATE_RE);
    if (!dateMatch) continue;

    // Combine this line + next 2 for amount hunting
    const window = [line, lines[i + 1] || '', lines[i + 2] || ''].join(' ');
    const amounts = [...window.matchAll(AMOUNT_RE)]
      .map(m => parseFloat(m[1].replace(/,/g, '')))
      .filter(n => n >= 0.50 && n < 100000);

    if (amounts.length === 0) continue;

    // Take smallest amount — balance is usually the largest number on the line
    const txAmount = amounts.length === 1 ? amounts[0] : Math.min(...amounts);

    let desc = line
      .replace(dateMatch[0], '')
      .replace(AMOUNT_RE, '')
      .replace(NOISE_RE, '')
      .replace(/[+\-$£€]/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();

    // If description too short, try next line
    if (desc.length < 3 && lines[i + 1] && !lines[i + 1].match(DATE_RE)) {
      const next = lines[i + 1].replace(AMOUNT_RE, '').replace(NOISE_RE, '').trim();
      if (next.length > 2) desc = next;
    }

    if (!desc || desc.length < 2) continue;

    transactions.push({ date: dateMatch[0].trim(), description: desc, amount: txAmount });
  }

  return transactions;
}

module.exports = { parseCSV, analyzeRecurring, parsePDF };
