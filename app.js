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
  renderExpenses();
}

function expenses() {
  return state.expenses || [];
}

function expenseTotal() {
  return expenses().reduce((sum, e) => sum + e.amount, 0);
}

function renderExpenses() {
  const list = expenses();
  $('expenseEmpty').hidden = list.length > 0;
  $('expenseSummary').hidden = list.length === 0;
  $('expenseTotal').textContent = money(expenseTotal(), 2);
  const ul = $('expenseList');
  ul.replaceChildren(...list.map((e, i) => {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = e.name;
    const amt = document.createElement('span');
    amt.className = 'amt';
    amt.textContent = '฿' + money(e.amount, 2);
    const del = document.createElement('button');
    del.className = 'del';
    del.setAttribute('aria-label', 'ลบ ' + e.name);
    del.textContent = '×';
    del.addEventListener('click', () => {
      if (!confirm(`ลบ "${e.name}" ใช่ไหม?`)) return;
      state.expenses.splice(i, 1);
      save(state);
      renderExpenses();
    });
    li.append(name, amt, del);
    return li;
  }));
}

// Counts toward the fixed-expense total at the same rate as income, stopping
// once it is covered, and projects when that happens in this cycle.
function renderExpenseProgress(earned, perMs, end) {
  const total = expenseTotal();
  if (total <= 0) return;
  const covered = Math.min(earned, total);
  const done = covered >= total;
  $('coveredValue').textContent = money(covered, 2);
  $('expenseBar').style.width = (covered / total * 100).toFixed(3) + '%';
  $('expenseSummary').classList.toggle('done', done);
  const at = state.cycleStart + total / perMs;
  let info;
  if (done) {
    info = `หาครบแล้วเมื่อ ${dateTimeText(at)} ที่เหลือคือเงินเก็บของรอบนี้`;
  } else if (at > end) {
    info = `รายได้รอบนี้ไม่พอ ขาดอีก ฿${money(total - state.salary, 2)}`;
  } else {
    info = `จะหาครบ ${dateTimeText(at)} (วันที่ ${Math.ceil((at - state.cycleStart) / UNITS.day.ms)} ของรอบ)`;
  }
  $('expenseInfo').textContent = info;
}

function dateTimeText(ms) {
  return new Date(ms).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' น.';
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

    renderExpenseProgress(earned, perMs, end);

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
  state = { ...state, salary, cycleStart: start, unit: state ? state.unit : 'second' };
  save(state);
  showCounter();
});

$('cancelSetup').addEventListener('click', showCounter);
$('settingsBtn').addEventListener('click', () => showSetup(Boolean(state)));

function closeExpenseForm() {
  $('expenseForm').hidden = true;
  $('addExpenseBtn').hidden = false;
}

$('addExpenseBtn').addEventListener('click', () => {
  $('expenseForm').reset();
  $('expenseError').hidden = true;
  $('expenseForm').hidden = false;
  $('addExpenseBtn').hidden = true;
  $('expenseName').focus();
});

$('cancelExpense').addEventListener('click', closeExpenseForm);

$('expenseForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('expenseName').value.trim();
  const amount = Number($('expenseAmount').value.replace(/[,\s฿]/g, ''));
  if (!name || !(amount > 0)) {
    $('expenseError').textContent = 'กรุณาใส่ชื่อและจำนวนเงินที่มากกว่า 0';
    $('expenseError').hidden = false;
    return;
  }
  state.expenses = [...expenses(), { name, amount }];
  save(state);
  closeExpenseForm();
  renderExpenses();
});

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
