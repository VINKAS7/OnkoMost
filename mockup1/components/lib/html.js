// Minimal tagged-template helper: escapes interpolations unless they are Raw.
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export class Raw {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}

export const raw = (s) => new Raw(String(s ?? ''));

function convert(v) {
  if (v == null || v === false) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(convert).join('');
  return String(v).replace(/[&<>"']/g, (c) => ESC[c]);
}

export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => { out += convert(v) + strings[i + 1]; });
  return new Raw(out);
}

export const escape = (s) => convert(String(s ?? ''));
