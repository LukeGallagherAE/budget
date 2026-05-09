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
  { pattern: /apple\.?com\/bill|itunes|apple\s*one/i, name: 'Apple', category: 'Subscriptions' },
  { pattern: /prime\s*video|amazon\s*prime/i, name: 'Prime Video', category: 'Subscriptions' },
  { pattern: /youtube\s*premium/i, name: 'YouTube Premium', category: 'Subscriptions' },
  { pattern: /\bhbo\b/i, name: 'HBO', category: 'Subscriptions' },
  { pattern: /paramount/i, name: 'Paramount+', category: 'Subscriptions' },
  { pattern: /peacock/i, name: 'Peacock', category: 'Subscriptions' },
  { pattern: /kayo/i, name: 'Kayo Sports', category: 'Subscriptions' },
  { pattern: /foxtel/i, name: 'Foxtel', category: 'Subscriptions' },
  { pattern: /\bamc\+/i, name: 'AMC+', category: 'Subscriptions' },
  { pattern: /microsoft\s*365|office\s*365|microsoft\s*office/i, name: 'Microsoft 365', category: 'Subscriptions' },
  { pattern: /adobe/i, name: 'Adobe', category: 'Subscriptions' },
  { pattern: /dropbox/i, name: 'Dropbox', category: 'Subscriptions' },
  { pattern: /icloud/i, name: 'iCloud', category: 'Subscriptions' },
  { pattern: /google\s*workspace|gsuite|g\s*suite/i, name: 'Google Workspace', category: 'Subscriptions' },
  { pattern: /google\s*(one|storage|play)/i, name: 'Google', category: 'Subscriptions' },
  { pattern: /canva/i, name: 'Canva', category: 'Subscriptions' },
  { pattern: /audible/i, name: 'Audible', category: 'Subscriptions' },
  { pattern: /kindle/i, name: 'Kindle Unlimited', category: 'Subscriptions' },
  { pattern: /duolingo/i, name: 'Duolingo', category: 'Subscriptions' },
  { pattern: /\btwitch\b/i, name: 'Twitch', category: 'Subscriptions' },
  { pattern: /openai|chatgpt/i, name: 'ChatGPT', category: 'Subscriptions' },
  { pattern: /patreon/i, name: 'Patreon', category: 'Subscriptions' },
  { pattern: /github/i, name: 'GitHub', category: 'Subscriptions' },
  { pattern: /1password/i, name: '1Password', category: 'Subscriptions' },
  { pattern: /lastpass/i, name: 'LastPass', category: 'Subscriptions' },
  { pattern: /nordvpn|expressvpn|surfshark/i, name: 'VPN', category: 'Subscriptions' },
  // Gaming
  { pattern: /nintendo/i, name: 'Nintendo', category: 'Entertainment' },
  { pattern: /play\s*station|psn|sony\s*interactive/i, name: 'PlayStation', category: 'Entertainment' },
  { pattern: /\bxbox\b|microsoft\s*store/i, name: 'Xbox', category: 'Entertainment' },
  { pattern: /\bsteam\b/i, name: 'Steam', category: 'Entertainment' },
  { pattern: /epic\s*games/i, name: 'Epic Games', category: 'Entertainment' },
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
  // Food delivery / meal kits
  { pattern: /uber\s*eats/i, name: 'Uber Eats', category: 'Food' },
  { pattern: /doordash/i, name: 'DoorDash', category: 'Food' },
  { pattern: /menulog/i, name: 'Menulog', category: 'Food' },
  { pattern: /deliveroo/i, name: 'Deliveroo', category: 'Food' },
  { pattern: /hellofresh/i, name: 'HelloFresh', category: 'Food' },
  { pattern: /marley\s*spoon/i, name: 'Marley Spoon', category: 'Food' },
  { pattern: /dinnerly/i, name: 'Dinnerly', category: 'Food' },
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
  { pattern: /nrma/i, name: 'NRMA Insurance', category: 'Insurance' },
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
  { pattern: /\bbupa/i, name: 'Bupa', category: 'Health' },
  { pattern: /\bhcf\b/i, name: 'HCF', category: 'Health' },
  { pattern: /\bahm\b/i, name: 'AHM', category: 'Health' },
  { pattern: /\bnib\b/i, name: 'NIB', category: 'Health' },
  { pattern: /health\s*fund|health\s*insurance/i, name: 'Health Insurance', category: 'Health' },
  // Gym/Fitness
  { pattern: /virgin\s*active/i, name: 'Virgin Active', category: 'Health' },
  { pattern: /anytime\s*fitness/i, name: 'Anytime Fitness', category: 'Health' },
  { pattern: /planet\s*fitness/i, name: 'Planet Fitness', category: 'Health' },
  { pattern: /goodlife/i, name: 'Goodlife', category: 'Health' },
  { pattern: /fitness\s*first/i, name: 'Fitness First', category: 'Health' },
  { pattern: /\bf45\b/i, name: 'F45', category: 'Health' },
  { pattern: /crossfit/i, name: 'CrossFit', category: 'Health' },
  { pattern: /crunch\s*fitness/i, name: 'Crunch Fitness', category: 'Health' },
  // Transport / Public transit / Fuel / Tolls
  { pattern: /transportfornsw|\bopal\b|transport\s*(for\s*)?nsw/i, name: 'Transport for NSW', category: 'Transport' },
  { pattern: /tfl\s*(travel|ch|go|pay)|tfl\.gov\.uk|transport\s*(for\s*)?london/i, name: 'Transport for London', category: 'Transport' },
  { pattern: /linkt|e-way\s*toll|roam\s*express|etoll/i, name: 'Linkt', category: 'Transport' },
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
  const cleaned = desc
    // Split CamelCase / PascalCase into spaced words so merchant patterns match correctly.
    // Needed for Feb-2026 CBA format where PDF encoding strips spaces:
    // "BupaAustralia" → "Bupa Australia", "PlayStationNetwork" → "Play Station Network"
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    // Strip CBA Direct Debit reference: "Direct Debit 408856 Merchant Name" or "DirectDebit408856MerchantName"
    .replace(/^direct\s*debit\s*\d+\s*/gi, '')
    // Strip payment processor prefixes: SQ*, SMP*, LSP*, ZLR*, DD*, SP*, TST*, etc.
    .replace(/^[a-z]{2,4}\s*\*/gi, '')
    .replace(/\*/g, ' ')
    .replace(/^(recurring\s+|subscription\s+)/gi, '')
    // Strip MIXED alphanumeric codes only (contain both letters AND digits, 6+ chars)
    // e.g. "P3ACEFB18C" is stripped, but "SYDNEY" or "AUSTRA" are NOT
    .replace(/\s+([A-Z0-9]{6,})\b/g, (m, tok) =>
      /[A-Za-z]/.test(tok) && /\d/.test(tok) ? '' : m)
    // Strip phone numbers and standalone reference numbers
    .replace(/\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/g, '')
    .replace(/\s+\d{6,}/g, '')
    .replace(/\s+\d{4,5}\b/g, '')   // strip 4-5 digit store numbers (e.g. "WOOLWORTHS 1063")
    .replace(/\s+#\w+/g, '')
    .replace(/\s+REF\w*/gi, '')
    // Strip trailing location / country suffixes
    // State+country: "NS AUS", "NSW AU", "VI AUS", "02 AUS" etc.
    .replace(/\s+(?:\d{2}|NSW|VIC|QLD|WA|SA|TAS|NT|ACT|NS|VI)\s+AUS?\s*$/gi, '')
    // City+optional-state+country: "SYDNEY NS AUS", "FRENCHS FORES AUS"
    .replace(/\s+[A-Z][A-Z\s]{3,20}\s+(?:NS|VI|NSW|VIC|QLD|AU)\s+AUS?\s*$/gi, '')
    .replace(/\s+[A-Z][A-Z\s]{3,20}\s+AUS?\s*$/gi, '')
    .replace(/\s+AUSTRALIA\s*$/gi, '')
    .replace(/\s+(?:AU|AUS)\s+(?:AU|AUS)\s*$/gi, '')
    .replace(/\s+(?:AU|AUS|US|USA|GB|UK|DE|DEU|GBR)\s*$/gi, '')
    // No-space suffix strip: handles "BUPAAUSTRALIA", "SPOTIFYAUSTRALIA" etc.
    // (no-space PDF format concatenates country name directly to merchant name)
    .replace(/AUSTRALIA$/i, '')
    .replace(/(?:AUS|USA|GBR)$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .toUpperCase();

  // Normalize to canonical merchant name for consistent grouping.
  // All "WOOLWORTHS 1573", "WOOLWORTHS 1262" etc. collapse into one key: "WOOLWORTHS".
  const merchant = identifyMerchant(cleaned);
  return merchant ? merchant.name.toUpperCase() : cleaned;
}

function guessCategory(name) {
  const merchant = identifyMerchant(name);
  if (merchant) return merchant.category;
  const n = name.toLowerCase();
  if (/gym|fitness|health|medical|pharmacy|chemist|doctor|dentist/.test(n)) return 'Health';
  if (/rent|mortgage|landlord|property|real estate/.test(n)) return 'Housing';
  if (/electric|energy|gas|water|internet|phone|broadband|telco/.test(n)) return 'Utilities';
  if (/insurance/.test(n)) return 'Insurance';
  if (/uber|lyft|transit|metro|bus|parking|fuel|petrol|toll/.test(n)) return 'Transport';
  if (/grocery|supermarket|food|cafe|restaurant/.test(n)) return 'Food';
  if (/game|gaming|cinema|theatre|entertainment/.test(n)) return 'Entertainment';
  if (/subscription|streaming|software/.test(n)) return 'Subscriptions';
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
  // ── CBA (Commonwealth Bank Australia) — two known PDF encodings ────────────
  //
  // Format A (older — e.g. Aug 2025): spaces preserved, separator between amounts:
  //   "01 MarSQ *EVOLVE WAHROONGA Wahroonga NS AUS"
  //   "Card xx3744"
  //   "Value Date: 28/02/202510.71$$6,991.68CR"    (debit AMOUNT$$BALANCE CR)
  //   "Value Date: 27/02/20259.56($6,982.12CR"      (debit AMOUNT($BALANCE CR)
  //   "Value Date: 07/03/2025$53.00$3,754.94CR"     (credit $AMOUNT$BALANCE CR)
  //   "06 MarDirect Debit 408856 Linkt Sydney"
  //   "50050394672420.00($1,412.25CR"
  //
  // Format B (newer — e.g. Feb 2026): ALL spaces stripped everywhere:
  //   "02SepSPDMSENGINEERINGMONTALBERTN VI AUS"
  //   "Cardxx3744"
  //   "ValueDate30/08/2025808.001,361.42CR"         (debit: no separator between amounts)
  //   "DirectDebit408856LinktSydney"
  //   "FastTransferFromMrLukeThomasGallag"          (income — SKIP_DESC_RE catches this)
  // ──────────────────────────────────────────────────────────────────────────

  const MONTH_NUM = {
    jan:'01', feb:'02', mar:'03', apr:'04', may:'05', jun:'06',
    jul:'07', aug:'08', sep:'09', oct:'10', nov:'11', dec:'12',
  };

  // "DD Mon" with optional year — handles both spaced ("01 Mar") and compact ("01Sep") formats.
  // Year restricted to 20xx and must be followed by a non-digit to avoid grabbing
  // description reference numbers like "6481_WESTFIELD" or "41260240 Jamie Oliver"
  const DATE_LINE_RE = /^(\d{1,2})\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s*(20\d{2}(?=[\s\D]))?\s*(.*)/i;

  // CBA debit amount pattern: AMOUNT then optional separator ($ or ($) then BALANCE then CR.
  // Sep-2026 statements strip all spaces so the separator disappears → use [\(\$]* (zero+).
  // The negative lookbehind (?<!\$) skips credit lines where $ precedes AMOUNT.
  const DEBIT_RE = /(?<!\$)(\d{1,3}(?:,\d{3})*\.\d{2})[\(\$]*([\d,]+\.\d{2})CR\s*$/i;

  // "Card xxNNNN" / "Cardxx3744" lines — skip entirely
  const CARD_LINE_RE = /^card\s*xx\d+/i;

  // "Value Date: DD/MM/YYYY..." / "ValueDate30/08/2025..." — amount is on this line
  const VALUE_DATE_RE = /^value\s*date[:\s]*/i;

  // Skip income / credit transactions (we only want outgoing expenses).
  // Uses \s* between words to match both spaced and compact (no-space) formats.
  const SKIP_DESC_RE = /^(opening\s*balance|closing\s*balance|fast\s*transfer\s*from|transfer\s*from|direct\s*credit|cash\s*deposit|interest\s*earned|salary|wages?)/i;

  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  const transactions = [];

  let currentYear = new Date().getFullYear();
  let state = null; // { date: 'YYYY-MM-DD', descParts: string[], amount: number|null }

  function flush() {
    if (!state) return;
    if (state.amount !== null && state.descParts.length > 0) {
      const desc = state.descParts.join(' ').trim();
      if (!SKIP_DESC_RE.test(desc) && desc.length >= 2 && state.amount >= 0.50) {
        transactions.push({ date: state.date, description: desc, amount: state.amount });
      }
    }
    state = null;
  }

  for (const line of lines) {
    const dateMatch = line.match(DATE_LINE_RE);

    if (dateMatch) {
      flush();
      const [, day, monStr, yearStr, rest] = dateMatch;
      if (yearStr) currentYear = parseInt(yearStr, 10);
      const mon = MONTH_NUM[monStr.toLowerCase()];
      const date = `${currentYear}-${mon}-${day.padStart(2, '0')}`;
      state = { date, descParts: [], amount: null };

      // Amount sometimes lives on the same date line (e.g. "Transfer to xx9318 CommBank app20.00($2,064.33CR")
      const amtMatch = rest && rest.match(DEBIT_RE);
      if (amtMatch) {
        state.amount = parseFloat(amtMatch[1].replace(/,/g, ''));
        const descPart = rest.replace(DEBIT_RE, '').trim();
        if (descPart) state.descParts.push(descPart);
        flush();
      } else if (rest && rest.trim()) {
        state.descParts.push(rest.trim());
      }
      continue;
    }

    if (!state) continue; // page headers and other noise — state is null between transactions

    if (CARD_LINE_RE.test(line)) continue; // "Card xx3744 AUD 53.00" — skip

    if (VALUE_DATE_RE.test(line)) {
      // Strip "Value Date: DD/MM/YYYY" / "ValueDate30/08/2025" prefix so the year digits
      // don't get absorbed into the amount (e.g. "...202510.71$$..." → "10.71$$...").
      const amountPart = line.replace(/^value\s*date[:\s]*\d{1,2}\/\d{2}\/\d{4}/i, '');

      // Extract the year from the Value Date and retroactively correct the transaction date.
      // This is critical for statements where date lines have no year ("01Sep") — we know
      // the correct year only once we see the Value Date line a few lines later.
      const vdDateMatch = line.match(/value\s*date[:\s]*(\d{1,2})\/(\d{2})\/(\d{4})/i);
      if (vdDateMatch && state) {
        const vdYear  = parseInt(vdDateMatch[3], 10);
        const vdMonth = parseInt(vdDateMatch[2], 10);
        currentYear = vdYear;
        // Retroactively fix the date we stored when we first saw the date line.
        // If the transaction month is less than the value-date month, the transaction
        // rolled into the next year (e.g. VD = 31 Dec 2025, TX = 01 Jan 2026).
        const parts   = state.date.split('-');
        const txMonth = parseInt(parts[1], 10);
        const txYear  = txMonth < vdMonth ? vdYear + 1 : vdYear;
        state.date = `${txYear}-${parts[1]}-${parts[2]}`;
      }

      // Debits: amount starts with digits immediately (e.g. "10.71$$..." or "808.001,361.42CR")
      // Credits: start with "$" (e.g. "$53.00$3,754.94CR") — skip those
      if (!amountPart.startsWith('$')) {
        const amtMatch = amountPart.match(/^(\d{1,3}(?:,\d{3})*\.\d{2})/);
        if (amtMatch) state.amount = parseFloat(amtMatch[1].replace(/,/g, ''));
      }
      flush(); // Value Date always ends the transaction block
      continue;
    }

    // Continuation line (direct debit reference / description overflow)
    const amtMatch = line.match(DEBIT_RE);
    if (amtMatch) {
      state.amount = parseFloat(amtMatch[1].replace(/,/g, ''));
      const descPart = line.replace(DEBIT_RE, '').trim();
      // Only add non-numeric leftover to description
      if (descPart && /[a-z]/i.test(descPart)) state.descParts.push(descPart);
      flush();
    } else {
      state.descParts.push(line);
    }
  }

  flush();

  // ── Fallback: generic parser for non-CBA PDFs ──────────────────────────────
  if (transactions.length === 0) {
    const GENERIC_DATE_RE = /\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}[\/\-]\d{2}[\/\-]\d{2})\b/;
    const GENERIC_AMT_RE = /(?<!\d)(\d{1,3}(?:,\d{3})*\.\d{2})(?!\d)/g;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const dMatch = line.match(GENERIC_DATE_RE);
      if (!dMatch) continue;
      const ctx = [line, lines[i + 1] || '', lines[i + 2] || ''].join(' ');
      const amounts = [...ctx.matchAll(GENERIC_AMT_RE)]
        .map(m => parseFloat(m[1].replace(/,/g, '')))
        .filter(n => n >= 0.50 && n < 100000);
      if (amounts.length === 0) continue;
      const desc = line
        .replace(dMatch[0], '')
        .replace(GENERIC_AMT_RE, '')
        .replace(/\b(CR|DR|CREDIT|DEBIT|OPENING|CLOSING|BALANCE)\b/gi, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
      if (!desc || desc.length < 2) continue;
      transactions.push({ date: dMatch[0], description: desc, amount: amounts[0] });
    }
  }

  return transactions;
}

module.exports = { parseCSV, analyzeRecurring, parsePDF };
