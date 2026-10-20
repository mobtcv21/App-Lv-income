// Fetches the prices the portfolio page needs and writes them to prices.json.
// Runs in GitHub Actions before each Pages deploy. Each source falls back to
// the previously deployed value when it fails, so one bad source never blanks
// the page. Usage: node scripts/fetch-prices.mjs [output path]
import { writeFileSync } from 'node:fs';

const OUT = process.argv[2] || 'prices.json';
const PREV_URL = process.env.PREV_URL;
const SEC_API_KEY = process.env.SEC_API_KEY;
const FUND = 'KKP US500-UH-E';
const FUND_PROJECT = 'KKP US500-UH';
const UA = { 'User-Agent': 'Mozilla/5.0 (Lv.income price fetcher)', Accept: 'application/json' };

async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers: { ...UA, ...headers }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${new URL(url).host}`);
  return res.json();
}

async function firstOf(label, attempts) {
  for (const [source, fn] of attempts) {
    try {
      const value = await fn();
      console.log(`${label}: ${value.price} from ${source}`);
      return { ...value, source };
    } catch (e) {
      console.log(`${label}: ${source} failed: ${e.message}`);
    }
  }
  return null;
}

function finite(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) throw new Error(`bad number ${n}`);
  return v;
}

async function yahoo(symbol) {
  const data = await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`);
  const meta = data.chart.result[0].meta;
  return { price: finite(meta.regularMarketPrice), at: new Date(meta.regularMarketTime * 1000).toISOString() };
}

function ymd(d) {
  return d.toISOString().slice(0, 10);
}

// Thai SEC Open Data API v2; needs a free subscription key (repo secret).
async function fundNav() {
  if (!SEC_API_KEY) throw new Error('SEC_API_KEY secret not set');
  const headers = { 'Ocp-Apim-Subscription-Key': SEC_API_KEY };
  const base = 'https://api.sec.or.th/v2/fund';
  const profiles = await getJson(`${base}/general-info/profiles?page_size=100&project_info=${encodeURIComponent(FUND_PROJECT)}&fund_status=Registered`, headers);
  const items = profiles.items || [];
  const project = items.find((p) => (p.proj_abbr_name || '').trim().toUpperCase() === FUND_PROJECT);
  if (!project) throw new Error(`project not found; got ${items.map((p) => p.proj_abbr_name).join(', ') || 'nothing'}`);
  const end = new Date();
  const start = new Date(end.getTime() - 14 * 86400000);
  const nav = await getJson(`${base}/daily-info/nav?page_size=100&proj_id=${encodeURIComponent(project.proj_id)}&start_nav_date=${ymd(start)}&end_nav_date=${ymd(end)}`, headers);
  const rows = nav.items || [];
  console.log(`fund: proj_id ${project.proj_id}, classes seen: ${[...new Set(rows.map((r) => r.fund_class_name))].join(', ')}`);
  const mine = rows
    .filter((r) => /(^|[\s-])E$/i.test((r.fund_class_name || '').trim()) || (r.fund_class_name || '').toUpperCase() === FUND)
    .filter((r) => Number(r.last_val) > 0)
    .sort((a, b) => String(b.nav_date).localeCompare(String(a.nav_date)));
  if (!mine.length) throw new Error('no NAV rows for class E');
  return { price: finite(mine[0].last_val), at: String(mine[0].nav_date) };
}

const prev = await (async () => {
  if (!PREV_URL) return {};
  try { return await getJson(PREV_URL); } catch (e) { console.log(`previous prices: ${e.message}`); return {}; }
})();
const prevPrices = prev.prices || {};

const fx = await firstOf('USDTHB', [
  ['Yahoo THB=X', () => yahoo('THB=X')],
  ['open.er-api.com', async () => {
    const d = await getJson('https://open.er-api.com/v6/latest/USD');
    return { price: finite(d.rates.THB), at: new Date(d.time_last_update_unix * 1000).toISOString() };
  }],
]);

const gold = await firstOf('XAU', [
  ['gold-api.com', async () => {
    const d = await getJson('https://api.gold-api.com/price/XAU');
    return { price: finite(d.price), at: d.updatedAt || new Date().toISOString() };
  }],
  ['Yahoo GC=F (futures)', () => yahoo('GC=F')],
]);

const fund = await firstOf(FUND, [['SEC Open Data', fundNav]]);

const out = {
  updatedAt: new Date().toISOString(),
  prices: {
    USDTHB: fx ? { ...fx, currency: 'THB', per: 'USD' } : prevPrices.USDTHB,
    XAU: gold ? { ...gold, currency: 'USD', per: 'oz' } : prevPrices.XAU,
    [FUND]: fund ? { ...fund, currency: 'THB', per: 'unit' } : prevPrices[FUND],
  },
};
writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out, null, 2));
