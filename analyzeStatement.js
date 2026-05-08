/**
 * Analyzes a bank statement CSV and detects recurring transactions.
 * Returns an array of detected recurring expense patterns.
 */

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];

  // Parse header
  const header = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, '').toLowerCase());

  // Find date, description, amount columns
  const dateCol = header.findIndex(h => /date|time|posted|transaction/i.test(h));
  const descCol = header.findIndex(h => /desc|memo|name|payee|merchant|narr/i.test(h));
  const amountCol = header.findIndex(h => /amount|debit|credit|sum|value/i.test(h));

  if (dateCol === -1 || descCol === -1 || amountCol === -1) {
    // Fallback: assume cols 0=date, 1=desc, 2=amount
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
  let cur = '';
  let inQuotes = false;
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
  // Try various formats
  const fmts = [
    /^(\d{4})-(\d{2})-(\d{2})$/, // YYYY-MM-DD
    /^(\d{2})\/(\d{2})\/(\d{4})$/, // MM/DD/YYYY
    /^(\d{2})-(\d{2})-(\d{4})$/, // MM-DD-YYYY
    /^(\d{2})\/(\d{2})\/(\d{2})$/, // MM/DD/YY
  ];

  // ISO
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    const d = new Date(str);
    if (!isNaN(d)) return d;
  }

  // MM/DD/YYYY
  const m1 = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m1) return new Date(`${m1[3]}-${m1[1].padStart(2,'0')}-${m1[2].padStart(2,'0')}`);

  // DD/MM/YYYY (European)
  const m2 = str.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m2) return new Date(`${m2[3]}-${m2[2].padStart(2,'0')}-${m2[1].padStart(2,'0')}`);

  const d = new Date(str);
  return isNaN(d) ? null : d;
}

function cleanDescription(desc) {
  // Strip trailing numbers, dates, reference codes to normalize merchant names
  return desc
    .replace(/\s+\d{4,}/g, '')
    .replace(/\s+#\w+/g, '')
    .replace(/\s+REF\w*/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .toUpperCase();
}

function guessCategory(name) {
  const n = name.toLowerCase();
  if (/netflix|spotify|hulu|disney|apple|amazon prime|youtube|hbo|paramount|peacock|sling|tidal/.test(n)) return 'Subscriptions';
  if (/gym|fitness|planet fitness|anytime fitness|crossfit/.test(n)) return 'Health';
  if (/rent|mortgage|landlord|property/.test(n)) return 'Housing';
  if (/electric|gas|water|sewage|internet|comcast|att|verizon|t-mobile|phone|broadband/.test(n)) return 'Utilities';
  if (/insurance|geico|progressive|allstate|state farm/.test(n)) return 'Insurance';
  if (/uber|lyft|transit|metro|bus|parking|fuel|gas station|shell|bp|chevron/.test(n)) return 'Transport';
  if (/grocery|walmart|costco|whole foods|trader joe|kroger|safeway|food/.test(n)) return 'Food';
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
  // Group by cleaned description
  const groups = {};
  for (const tx of transactions) {
    const key = cleanDescription(tx.description);
    if (!groups[key]) groups[key] = [];
    groups[key].push(tx);
  }

  const recurring = [];

  for (const [key, txs] of Object.entries(groups)) {
    if (txs.length < 2) continue;

    // Parse and sort dates
    const dated = txs
      .map(t => ({ ...t, parsedDate: normalizeDate(t.date) }))
      .filter(t => t.parsedDate)
      .sort((a, b) => a.parsedDate - b.parsedDate);

    if (dated.length < 2) continue;

    // Compute intervals in days
    const intervals = [];
    for (let i = 1; i < dated.length; i++) {
      const diff = Math.round((dated[i].parsedDate - dated[i - 1].parsedDate) / 86400000);
      if (diff > 0) intervals.push(diff);
    }

    if (intervals.length === 0) continue;

    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const sd = stddev(intervals);

    // Consider recurring if stddev < 30% of average (or < 5 days for short intervals)
    const threshold = Math.max(5, avgInterval * 0.35);
    if (sd > threshold) continue;

    const amounts = dated.map(t => t.amount).filter(Boolean);
    const avgAmount = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const amountVariance = Math.max(...amounts) - Math.min(...amounts);

    // Skip if amount varies too much (> 20%)
    if (amountVariance > avgAmount * 0.25 && amountVariance > 5) continue;

    const frequency = classifyFrequency(avgInterval);
    const lastDate = dated[dated.length - 1].parsedDate;
    const lastDateStr = lastDate.toISOString().split('T')[0];

    // Confidence: based on occurrences, interval consistency, amount consistency
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

  // Sort by confidence desc
  return recurring.sort((a, b) => b.confidence - a.confidence);
}


function parsePDF(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 3);
  const transactions = [];
  for (const line of lines) {
    const dateMatch = line.match(
      /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})|(\d{4}[\/\-]\d{2}[\/\-]\d{2})|([A-Z][a-z]{2}\.?\s+\d{1,2},?\s+\d{4})|(\d{1,2}\s+[A-Z][a-z]{2}\.?\s+\d{4})/
    );
    if (!dateMatch) continue;
    const amounts = [...line.matchAll(/(?<![0-9])(\d{1,3}(?:,\d{3})*\.\d{2})(?![0-9])/g)]
      .map(m => parseFloat(m[1].replace(/,/g, '')))
      .filter(n => n > 0.5 && n < 99999);
    if (amounts.length === 0) continue;
    let desc = line
      .replace(dateMatch[0], '')
      .replace(/(?<![0-9])(\d{1,3}(?:,\d{3})*\.\d{2})(?![0-9])/g, '')
      .replace(/\b(CR|DR|CREDIT|DEBIT|OPENING|CLOSING|BALANCE|TOTAL|BROUGHT|FORWARD|CARRIED)\b/gi, '')
      .replace(/[$£€+\-]/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (!desc || desc.length < 2) continue;
    transactions.push({ date: dateMatch[0].trim(), description: desc, amount: amounts[amounts.length - 1] });
  }
  return transactions;
}

module.exports = { parseCSV, analyzeRecurring, parsePDF };
