// Demo dates per screen + small date helpers (dates are ISO strings 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:MM').
export const DEMO_DATES = { overview: '2026-01-06', gp: '2026-01-06', koordinator: '2026-01-12', mdt: '2026-01-13', revizni: '2026-01-27' };

export function currentScreen() {
  const m = location.hash.match(/^#\/([a-z]+)/);
  const s = m && m[1];
  return ['gp', 'koordinator', 'mdt', 'revizni'].includes(s) ? s : 'overview';
}

// A case may have its own demo clock (cases.js demoDates, e.g. Procházková in October 2026). store.js installs the
// resolver; without a case id it answers for the case selected on that screen.
let caseDate = () => null;
export const setCaseDateResolver = (fn) => { caseDate = fn; };

export const demoDate = (screen = currentScreen(), caseId) => caseDate(screen, caseId) || DEMO_DATES[screen];
export const dateOnly = (d) => (d ? d.slice(0, 10) : null);

const toUTC = (d) => {
  const [y, m, dd] = d.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, dd);
};

export const daysBetween = (a, b) => Math.round((toUTC(b) - toUTC(a)) / 864e5);
export const addDays = (d, n) => new Date(toUTC(d) + n * 864e5).toISOString().slice(0, 10);
export const maxDate = (a, b) => (a > b ? a : b);

export function fmtDate(d, { year = false, time = true } = {}) {
  if (!d) return '–';
  const [y, m, dd] = d.slice(0, 10).split('-').map(Number);
  let s = `${dd}. ${m}.` + (year ? ` ${y}` : '');
  if (time && d.length > 10) s += ' ' + d.slice(11, 16);
  return s;
}

export function nowStamp(screen = currentScreen(), caseId) {
  const n = new Date();
  const hh = String(n.getHours()).padStart(2, '0');
  const mm = String(n.getMinutes()).padStart(2, '0');
  return `${demoDate(screen, caseId)}T${hh}:${mm}`;
}

export const isOverdue = (task, screen, caseId) => task.status !== 'done' && dateOnly(task.due) < demoDate(screen, caseId);

export function dueLabel(task, screen, caseId) {
  const today = demoDate(screen, caseId);
  const d = dateOnly(task.due);
  const time = task.due.length > 10 ? ' ' + task.due.slice(11, 16) : '';
  if (task.status !== 'done') {
    if (d === today) return 'dnes' + time;
    if (d < today) return 'termín byl ' + fmtDate(task.due, { time: false });
  }
  return fmtDate(task.due);
}

export function plural(n, one, few, many) {
  if (n === 1) return one;
  if (n >= 2 && n <= 4) return few;
  return many;
}

export const days = (n) => `${n} ${plural(n, 'den', 'dny', 'dní')}`;
