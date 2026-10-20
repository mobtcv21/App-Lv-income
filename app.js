'use strict';

const STORE_KEY = 'lv-income';
const UNITS = {
  second: { ms: 1000, label: 'บาทต่อวินาที', digits: 4 },
  hour: { ms: 3600 * 1000, label: 'บาทต่อชั่วโมง', digits: 2 },
  day: { ms: 24 * 3600 * 1000, label: 'บาทต่อวัน', digits: 2 },
};

const $ = (id) => document.getElementById(id);

function load() {
  try {
    const data = JSON.parse(localStorage.getItem(STORE_KEY));
    if (data && data.salary > 0 && data.cycleStart > 0) return data;
  } catch (e) { /* storage unavailable or corrupt */ }
  return null;
}

function save(data) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch (e) { /* ignore */ }
}

let state = load();

// The cycle ends on the same date next month, clamped to that month's last day
// (a reset on Jan 31 ends on Feb 28/29).
function cycleEnd(start) {
  const d = new Date(start);
  const day = d.getDate();
  const end = new Date(d);
  end.setDate(1);
  end.setMonth(end.getMonth() + 1);
  const lastDay = new Date(end.getFullYear(), end.getMonth() + 1, 0).getDate();
  end.setDate(Math.min(day, lastDay));
  return end.getTime();
}

function money(n, digits) {
  return n.toLocaleString('th-TH', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function dateText(ms) {
  return new Date(ms).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
}

function toLocalInput(ms) {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
}

function showSetup(editing) {
  $('counter').hidden = true;
  $('setup').hidden = false;
  $('setupError').hidden = true;
  $('cancelSetup').hidden = !editing;
  $('salaryInput').value = state ? String(state.salary) : '';
  $('startInput').value = toLocalInput(state ? state.cycleStart : Date.now());
}

function showCounter() {
  $('setup').hidden = true;
  $('counter').hidden = false;
  renderUnit();
}

function renderUnit() {
  const unit = state.unit || 'second';
  document.querySelectorAll('.seg button').forEach((b) => {
    b.setAttribute('aria-selected', String(b.dataset.unit === unit));
  });
  $('rateUnit').textContent = UNITS[unit].label;
}

function tick() {
  if (state && !$('counter').hidden) {
    const now = Date.now();
    const end = cycleEnd(state.cycleStart);
    const length = end - state.cycleStart;
    const perMs = state.salary / length;
    const elapsed = Math.min(Math.max(now - state.cycleStart, 0), length);
    const earned = perMs * elapsed;

    const [whole, frac] = money(earned, 4).split('.');
    $('earnedMain').textContent = whole;
    $('earnedFrac').textContent = '.' + frac;
    $('progressBar').style.width = (elapsed / length * 100).toFixed(3) + '%';

    const unit = UNITS[state.unit || 'second'];
    $('rateValue').textContent = money(perMs * unit.ms, unit.digits);

    const daysLeft = Math.ceil((end - now) / UNITS.day.ms);
    $('cycleInfo').textContent = now >= end
      ? 'ครบรอบแล้ว กดรีเซ็ตเมื่อเงินเดือนเข้า'
      : `รอบนี้ ${dateText(state.cycleStart)} ถึง ${dateText(end)} · เหลืออีก ${daysLeft} วัน`;
  }
  requestAnimationFrame(tick);
}

$('setupForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const salary = Number($('salaryInput').value.replace(/[,\s฿]/g, ''));
  const start = new Date($('startInput').value).getTime();
  const err = $('setupError');
  if (!(salary > 0)) {
    err.textContent = 'กรุณาใส่เงินเดือนเป็นตัวเลขที่มากกว่า 0';
    err.hidden = false;
    return;
  }
  if (!(start > 0) || start > Date.now()) {
    err.textContent = 'วันที่เงินเดือนเข้าต้องไม่เป็นเวลาในอนาคต';
    err.hidden = false;
    return;
  }
  state = { salary, cycleStart: start, unit: state ? state.unit : 'second' };
  save(state);
  showCounter();
});

$('cancelSetup').addEventListener('click', showCounter);
$('settingsBtn').addEventListener('click', () => showSetup(Boolean(state)));

$('resetBtn').addEventListener('click', () => {
  if (!confirm('เงินเดือนเข้าแล้วใช่ไหม? ตัวนับจะเริ่มใหม่จากตอนนี้')) return;
  state.cycleStart = Date.now();
  save(state);
});

document.querySelectorAll('.seg button').forEach((b) => {
  b.addEventListener('click', () => {
    state.unit = b.dataset.unit;
    save(state);
    renderUnit();
  });
});

if (state) showCounter(); else showSetup(false);
requestAnimationFrame(tick);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
