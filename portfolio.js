'use strict';

// Portfolio dashboard. Holdings live in the same browser storage as the
// counter; prices come from prices.json, which the Pages deploy refreshes on a
// schedule (see scripts/fetch-prices.mjs).
const GRAMS_PER_OZ = 31.1034768;
const UNIT_LABEL = { unit: 'หน่วย', g: 'กรัม', oz: 'ออนซ์' };
const SOURCE_DEFAULTS = {
  'KKP US500-UH-E': { name: 'KKP US500-UH-E', unit: 'unit', currency: 'THB' },
  XAU: { name: 'ทองคำ', unit: 'g', currency: 'USD' },
  manual: { name: '', unit: 'unit', currency: 'THB' },
};

let prices = null;
let editingId = null;

function holdings() {
  return state.holdings || [];
}

function num(text) {
  return Number(String(text).replace(/[,\s฿$]/g, ''));
}

function usdThb() {
  const fx = prices && prices.prices && prices.prices.USDTHB;
  return fx ? fx.price : null;
}

// Baht per one unit of the holding, or null when no price is known.
function priceThb(h) {
  const fx = usdThb();
  if (h.manualPrice > 0) {
    if (h.currency === 'THB') return h.manualPrice;
    return fx ? h.manualPrice * fx : null;
  }
  const p = prices && prices.prices && prices.prices[h.source];
  if (!p) return null;
  let perUnit = p.price;
  if (h.source === 'XAU') perUnit = h.unit === 'g' ? p.price / GRAMS_PER_OZ : p.price;
  if (p.currency === 'USD') return fx ? perUnit * fx : null;
  return perUnit;
}

// USD costs are converted at today's rate, so P/L shows the asset's own move.
function costThb(h) {
  if (h.currency === 'THB') return h.cost;
  const fx = usdThb();
  return fx ? h.cost * fx : null;
}

function signed(n) {
  return (n >= 0 ? '+' : '−') + '฿' + money(Math.abs(n), 2);
}

function pnlNode(pnl, pct) {
  const p = el('span', pnl >= 0 ? 'gain' : 'loss', `${signed(pnl)} (${pnl >= 0 ? '+' : '−'}${money(Math.abs(pct), 2)}%)`);
  return p;
}

function priceTime(h) {
  if (h.manualPrice > 0) return 'ราคากรอกเอง';
  const p = prices && prices.prices && prices.prices[h.source];
  if (!p) return 'ยังไม่มีราคา กดแก้ไขเพื่อกรอกราคาเอง';
  // Fund NAV comes as a date only; other prices carry a time.
  const when = new Date(p.at);
  const label = isNaN(when) ? p.at : /^\d{4}-\d{2}-\d{2}$/.test(p.at) ? 'NAV วันที่ ' + dateText(when.getTime()) : dateTimeText(when.getTime());
  const what = h.source === 'XAU' ? `$${money(p.price, 2)}/ออนซ์` : `฿${money(p.price, 4)}/หน่วย`;
  return `${what} · ${label}`;
}

function renderPortfolio() {
  const list = holdings();
  const rows = list.map((h) => {
    const price = priceThb(h);
    const cost = costThb(h);
    return {
      h,
      value: price == null ? null : price * h.units,
      costTotal: cost == null ? null : cost * h.units,
    };
  });
  const priced = rows.filter((r) => r.value != null && r.costTotal != null);
  const total = priced.reduce((s, r) => s + r.value, 0);
  const totalCost = priced.reduce((s, r) => s + r.costTotal, 0);

  $('pfValue').textContent = money(total, 2);
  $('pfPnl').replaceChildren(...(totalCost > 0 ? [pnlNode(total - totalCost, (total - totalCost) / totalCost * 100)] : []));
  $('pfCost').textContent = totalCost > 0 ? `ต้นทุนรวม ฿${money(totalCost, 2)}` : '';
  const missing = rows.length - priced.length;
  const fx = usdThb();
  $('pfUpdated').textContent = [
    prices && prices.updatedAt ? 'อัปเดตราคา ' + dateTimeText(new Date(prices.updatedAt).getTime()) : 'ยังไม่มีไฟล์ราคา',
    fx ? `1 USD = ฿${money(fx, 2)}` : '',
    missing ? `${missing} รายการยังไม่มีราคา` : '',
  ].filter(Boolean).join(' · ');

  $('holdingEmpty').hidden = list.length > 0;
  $('holdingList').replaceChildren(...rows.map(({ h, value, costTotal }) => {
    const li = el('li');
    const head = el('div', 'item-head');
    const edit = el('button', 'del', '✎');
    edit.setAttribute('aria-label', 'แก้ไข ' + h.name);
    edit.addEventListener('click', () => openHoldingForm(h));
    const del = el('button', 'del', '×');
    del.setAttribute('aria-label', 'ลบ ' + h.name);
    del.addEventListener('click', () => {
      if (!confirm(`ลบ "${h.name}" ใช่ไหม?`)) return;
      state.holdings = holdings().filter((x) => x.id !== h.id);
      save(state);
      renderPortfolio();
    });
    head.append(el('span', 'name', h.name), edit, del);

    const amt = el('p', 'item-amt');
    amt.append(el('span', '', value == null ? '฿ –' : '฿' + money(value, 2)));
    if (value != null && costTotal > 0) amt.append(' ', pnlNode(value - costTotal, (value - costTotal) / costTotal * 100));

    const share = value != null && total > 0 ? value / total * 100 : 0;
    const bar = el('div', 'progress');
    const fill = el('div');
    fill.style.width = share.toFixed(2) + '%';
    bar.append(fill);

    const cur = h.currency === 'USD' ? '$' : '฿';
    li.append(head, amt, bar,
      el('p', 'muted small', `${money(h.units, 4)} ${UNIT_LABEL[h.unit]} · ต้นทุน ${cur}${money(h.cost, 2)}/${UNIT_LABEL[h.unit]} · ${money(share, 1)}% ของพอร์ต`),
      el('p', 'muted small', priceTime(h)));
    return li;
  }));
}

async function loadPrices() {
  try {
    const res = await fetch('prices.json', { cache: 'no-store' });
    if (res.ok) prices = await res.json();
  } catch (e) { /* offline and not cached yet */ }
  if (!$('portfolio').hidden) renderPortfolio();
}

function showPortfolio() {
  $('counter').hidden = true;
  $('portfolio').hidden = false;
  renderPortfolio();
  loadPrices();
}

function applySourceDefaults() {
  const d = SOURCE_DEFAULTS[$('hSource').value];
  $('hName').value = d.name;
  $('hUnit').value = d.unit;
  $('hCurrency').value = d.currency;
  updatePriceHint();
}

function updateUnitLabels() {
  const u = UNIT_LABEL[$('hUnit').value];
  $('hCostLabel').textContent = `ต้นทุนเฉลี่ยต่อ${u}`;
  $('hPriceLabel').textContent = `ราคาปัจจุบันต่อ${u} (กรอกเอง)`;
}

function updatePriceHint() {
  updateUnitLabels();
  const src = $('hSource').value;
  $('hPriceHint').textContent = src === 'manual'
    ? 'ต้องกรอกราคาปัจจุบันเอง ในสกุลเงินเดียวกับต้นทุน'
    : 'เว้นว่างไว้เพื่อใช้ราคาอัตโนมัติ หรือกรอกเพื่อใช้ราคานี้แทน';
  $('hPrice').required = src === 'manual';
}

function openHoldingForm(h) {
  editingId = h ? h.id : null;
  $('holdingForm').reset();
  $('holdingError').hidden = true;
  if (h) {
    $('hSource').value = h.source;
    $('hName').value = h.name;
    $('hUnits').value = String(h.units);
    $('hUnit').value = h.unit;
    $('hCost').value = String(h.cost);
    $('hCurrency').value = h.currency;
    $('hPrice').value = h.manualPrice > 0 ? String(h.manualPrice) : '';
    updatePriceHint();
  } else {
    applySourceDefaults();
  }
  $('holdingForm').hidden = false;
  $('addHoldingBtn').hidden = true;
  $('holdingForm').scrollIntoView({ block: 'nearest' });
}

function closeHoldingForm() {
  $('holdingForm').hidden = true;
  $('addHoldingBtn').hidden = false;
  editingId = null;
}

$('addHoldingBtn').addEventListener('click', () => openHoldingForm(null));
$('cancelHolding').addEventListener('click', closeHoldingForm);
$('hSource').addEventListener('change', applySourceDefaults);
$('hUnit').addEventListener('change', updateUnitLabels);

$('holdingForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const source = $('hSource').value;
  const name = $('hName').value.trim();
  const units = num($('hUnits').value);
  const cost = num($('hCost').value);
  const priceText = $('hPrice').value.trim();
  const manualPrice = priceText ? num(priceText) : 0;
  const unit = $('hUnit').value;
  const err = $('holdingError');
  let problem = '';
  if (!name || !(units > 0) || !(cost > 0)) problem = 'กรุณาใส่ชื่อ จำนวน และต้นทุนเฉลี่ยที่มากกว่า 0';
  else if (priceText && !(manualPrice > 0)) problem = 'ราคาที่กรอกต้องเป็นตัวเลขที่มากกว่า 0';
  else if (source === 'manual' && !(manualPrice > 0)) problem = 'รายการนี้ต้องกรอกราคาปัจจุบันเอง';
  else if (source === 'XAU' && unit === 'unit') problem = 'ทองคำต้องเลือกหน่วยเป็นกรัมหรือออนซ์';
  if (problem) {
    err.textContent = problem;
    err.hidden = false;
    return;
  }
  const h = { id: editingId || String(Date.now()), source, name, units, unit, cost, currency: $('hCurrency').value, manualPrice };
  state.holdings = editingId ? holdings().map((x) => (x.id === editingId ? h : x)) : [...holdings(), h];
  save(state);
  closeHoldingForm();
  renderPortfolio();
});
