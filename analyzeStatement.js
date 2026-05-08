/**
 * Analyzes a bank statement (CSV or PDF) and detects recurring transactions.
 */

// Known merchant lookup — maps raw PDF/bank text to canonical name + category
const MERCHANT_MAP = [
  // Streaming & Subscriptions
  { pattern: /netflix/i, name: 'Netflix', category: 'Subscriptions' },
  { pattern: /spotify/i, name: 'Spotify', category: 'Subscriptions' },
  { pattern: /\bstan\b/i, name: 'Stan', category: 'Subscriptions' },
  { pattern: /\bbinge\b/i, name: 'Binge', category: 'Subscriptions' },
  { pattern: /disney[+\s]?plus|disneyplus|disney\+/i, name: 'Disney+', category: 'Subscriptions' },
  { pattern: /apple\.?com\/bill|itunes|apple one/i, name: 'Apple', category: 'Subscriptions' },
  { pattern: /amazon\s*prime|prime\s*video/i, name: 'Amazon Prime', category: 'Subscriptions' },
  { pattern: /youtube\s*premium/i, name: 'YouTube Premium', category: 'Subscriptions' },
  { pattern: /\bhbo\b/i, name: 'HBO', category: 'Subscriptions' },
  { pattern: /paramount/i, name: 'Paramount+', category: 'Subscriptions' },
  { pattern: /peacock/i, name: 'Peacock', category: 'Subscriptions' },
  { pattern: /kayo/i, name: 'Kayo Sports', category: 'Subscriptions' },
  { pattern: /foxtel/i, name: 'Foxtel', category: 'Subscriptions' },
  { pattern: /\bamc\+/i, name: 'AMC+', category: 'Subscriptions' },
  { pattern: /microsoft 365|office 365|microsoft office/i, name: 'Microsoft 365', category: 'Subscriptions' },
  { pattern: /adobe/i, name: 'Adobe', category: 'Subscriptions' },
  { pattern: /dropbox/i, name: 'Dropbox', category: 'Subscriptions' },
  { pattern: /icloud/i, name: 'iCloud', category: 'Subscriptions' },
  { pattern: /google (one|storage|play)/i, name: 'Google', category: 'Subscriptions' },
  { pattern: /canva/i, name: 'Canva', category: 'Subscriptions' },
  { pattern: /audible/i, name: 'Audible', category: 'Subscriptions' },
  { pattern: /kindle/i, name: 'Kindle', category: 'Subscriptions' },
  { pattern: /duolingo/i, name: 'Duolingo', category: 'Subscriptions' },
  { pattern: /\btwitch\b/i, name: 'Twitch', category: 'Subscriptions' },
  // Groceries
  { pattern: /woolworths|woolies|\bwww?\s*metro\b/i, name: 'Woolworths', category: 'Food' },
  { pattern: /\bcoles\b(?!\s*express)/i, name: 'Coles', category: 'Food' },
  { pattern: /\baldi\b/i, name: 'Aldi', category: 'Food' },
  { pattern: /\biga\b/i, name: 'IGA', category: 'Food' },
  { pattern: /costco/i, name: 'Costco', category: 'Food' },
  { pattern: /harris farm/i, name: 'Harris Farm', category: 'Food' },
  { pattern: /trader joe/i, name: "Trader Joe's", category: 'Food' },
  { pattern: /whole foods/i, name: 'Whole Foods', category: 'Food' },
  { pattern: /safeway/i, name: 'Safeway', category: 'Food' },
  // Food delivery
  { pattern: /uber\s*eats/i, name: 'Uber Eats', category: 'Food' },
  { pattern: /doordash/i, name: 'DoorDash', category: 'Food' },
  { pattern: /menulog/i, name: 'Menulog', category: 'Food' },
  { pattern: /deliveroo/i, name: 'Deliveroo', category: 'Food' },
  // Utilities
  { pattern: /origin\s*energy/i, name: 'Origin Energy', category: 'Utilities' },
  { pattern: /\bagl\b/i, name: 'AGL', category: 'Utilities' },
  { pattern: /energyaustralia/i, name: 'EnergyAustralia', category: 'Utilities' },
  { pattern: /sydney\s*water|sa\s*water|yarra\s*valley\s*water|western\s*water|unity\s*water/i, name: 'Water', category: 'Utilities' },
  { pattern: /ausgrid|energex|western\s*power|essential\s*energy|powercor|jemena/i, name: 'Electricity', category: 'Utilities' },
  // Telco
  { pattern: /telstra/i, name: 'Telstra', category: 'Utilities' },
  { pattern: /optus/i, name: 'Optus', category: 'Utilities' },
  { pattern: /vodafone/i, name: 'Vodafone', category: 'Utilities' },
  { pattern: /\btpg\b/i, name: 'TPG', category: 'Utilities' },
  { pattern: /aussie\s*broadband/i, name: 'Aussie Broadband', category: 'Utilities' },
  { pattern: /iinet/i, name: 'iiNet', category: 'Utilities' },
  { pattern: /\bnbn\b/i, name: 'NBN', category: 'Utilities' },
  // Insurance
  { pattern: /nrma/i, name: 'NRMA', category: 'Insurance' },
  { pattern: /\baami\b/i, name: 'AAMI', category: 'Insurance' },
  { pattern: /budget\s*direct/i, name: 'Budget Direct', category: 'Insurance' },
  { pattern: /allianz/i, name: 'Allianz', category: 'Insurance' },
  { pattern: /suncorp/i, name: 'Suncorp', category: 'Insurance' },
  { pattern: /qbe/i, name: 'QBE', category: 'Insurance' },
  { pattern: /youi/i, name: 'Youi', category: 'Insurance' },
  { pattern: /real\s*insurance/i, name: 'Real Insurance', category: 'Insurance' },
  { pattern: /comminsure/i, name: 'CommInsure', category: 'Insurance' },
  // Health insurance
  { pattern: /medibank/i, name: 'Medibank', category: 'Health' },
  { pattern: /\bbupa\b/i, name: 'Bupa', category: 'Health' },
  { pattern: /\bhcf\b/i, name: 'HCF', category: 'Health' },
  { pattern: /\bahm\b/i, name: 'AHM', category: 'Health' },
  { pattern: /\bnib\b/i, name: 'NIB', category: 'Health' },
  { pattern: /health\s*fund|health\s*insurance/i, name: 'Health Insurance', category: 'Health' },
  // Gym/Fitness
  { pattern: /anytime\s*fitness/i, name: 'Anytime Fitness', category: 'Health' },
  { pattern: /planet\s*fitness/i, name: 'Planet Fitness', category: 'Health' },
  { pattern: /goodlife/i, name: 'Goodlife', category: 'Health' },
  { pattern: /fitness\s*first/i, name: 'Fitness First', category: 'Health' },
  { pattern: /\bf45\b/i, name: 'F45', category: 'Health' },
  { pattern: /crossfit/i, name: 'CrossFit', category: 'Health' },
  { pattern: /crunch\s*fitness/i, name: 'Crunch Fitness', category: 'Health' },
  // Transport / Fuel
  { pattern: /coles\s*express|shell/i, name: 'Shell/Coles Express', category: 'Transport' },
  { pattern: /\bbp\b/i, name: 'BP', category: 'Transport' },
  { pattern: /ampol|caltex/i, name: 'Ampol', category: 'Transport' },
  { pattern: /7.?eleven/i, name: '7-Eleven', category: 'Transport' },
  { pattern: /opal\s*card|myki|go\s*card|translink|myway/i, name: 'Public Transport', category: 'Transport' },
  { pattern: /\buber\b(?!\s*eats)/i, name: 'Uber', category: 'Transport' },
  { pattern: /\bdidi\b/i, name: 'DiDi', category: 'Transport' },
  { pattern: /\blyft\b/i, name: 'Lyft', category: 'Transport' },
  // Housing
  { pattern: /rent\s*payment|rental/i, name: 'Rent', category: 'Housing' },
  { pattern: /mortgage|home\s*loan/i, name: 'Mortgage', category: 'Housing' },
  { pattern: /body\s*corp|strata/i, name: 'Body Corporate', category: 'Housing' },
];

function identifyMerchant(rawDesc) {
  for (const m of MERCHANT_MAP) {
    if (m.pattern.test(rawDesc)) return { name: m.name, category: m.category };
  }
  return null;
}

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
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    const d = new Date(str);
    if (!isNaN(d)) return d;
  }
  // DD/MM/YYYY (Australian) — try this first
  const m1 = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m1) {
    const [, a, b, yr] = m1;
    const d1 = new Date(`${yr}-${b.padStart(2,'0')}-${a.padStart(2,'0')}`);
    if (!isNaN(d1)) return d1;
    const d2 = new Date(`${yr}-${a.padStart(2,'0')}-${b.padStart(2,'0')}`);
    if (!isNaN(d2)) return d2;
  }
  const m2 = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})$/);
  if (m2) {
    const yr = parseInt(m2[3]) + 2000;
    const d = new Date(`${yr}-${m2[2].padStart(2,'0')}-${m2[1].padStart(2,'0')}`);
    if (!isNaN(d)) return d;
  }
  const d = new Date(str);
  return isNaN(d) ? null : d;
}

function cleanDescription(desc) {
  return desc
    // Strip common bank prefixes
    .replace(/^(sp\s*\*|sq\s*\*|tst\*|dd\s+|direct\s+debit\s+|recurring\s+|subscription\s+)/gi, '')
    // Strip phone numbers
    .replace(/\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/g, '')
    // Strip reference numbers (6+ digits)
    .replace(/\s+\d{6,}/g, '')
    .replace(/\s+#\w+/g, '')
    .replace(/\s+REF\w*/gi, '')
    // Strip country/state suffixes
    .replace(/\s+(AU|AUS|US|USA|GB|UK)\s*$/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .toUpperCase();
}

function guessCategory(name) {
  const merchant = identifyMerchant(name);
  if (merchant) return merchant.category;
  const n = name.toLowerCase();
  if (/gym|fitness|health|medical|pharmacy|chemist|doctor|dentist/.test(n)) return 'Health';
  if (/rent|mortgage|landlord|property|real estate/.test(n)) return 'Housing';
  if (/electric|energy|gas|water|internet|phone|broadband|telco/.test(n)) return 'Utilities';
  if (/insurance/.test(n)) return 'Insurance';
  if (/uber|lyft|transit|metro|bus|parking|fuel|petrol/.test(n)) return 'Transport';
  if (/grocery|supermarket|food|cafe|restaurant/.test(n)) return 'Food';
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
    const threshold = Math.max(7, avgInterval * 0.45);
    if (sd > threshold) continue;

    const amounts = dated.map(t => t.amount).filter(Boolean);
    const avgAmount = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const amountVariance = Math.max(...amounts) - Math.min(...amounts);
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

    // Use merchant lookup for clean name + category
    const merchant = identifyMerchant(key);
    const displayName = merchant ? merchant.name : (key.charAt(0) + key.slice(1).toLowerCase());
    const category = merchant ? merchant.category : guessCategory(key);

    recurring.push({
      name: displayName,
      amount: parseFloat(avgAmount.toFixed(2)),
      frequency,
      interval_days: frequency === 'custom' ? Math.round(avgInterval) : null,
      occurrences: dated.length,
      last_date: lastDateStr,
      confidence,
      category,
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
    const window = [line, lines[i + 1] || '', lines[i + 2] || ''].join(' ');
    const amounts = [...window.matchAll(AMOUNT_RE)]
      .map(m => parseFloat(m[1].replace(/,/g, '')))
      .filter(n => n >= 0.50 && n < 100000);
    if (amounts.length === 0) continue;
    const txAmount = amounts.length === 1 ? amounts[0] : Math.min(...amounts);
    let desc = line
      .replace(dateMatch[0], '')
      .replace(AMOUNT_RE, '')
      .replace(NOISE_RE, '')
      .replace(/[+\-$£€]/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
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
