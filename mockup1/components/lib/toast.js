// Toast notifications rendered into a light-DOM live region (styled in theme.css).
export function toast(message, { href, linkText, tone = '' } = {}) {
  let host = document.getElementById('koc-toasts');
  if (!host) {
    host = document.createElement('div');
    host.id = 'koc-toasts';
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    document.body.append(host);
  }
  const t = document.createElement('div');
  t.className = `koc-toast ${tone}`;
  const text = document.createElement('span');
  text.textContent = message;
  t.append(text);
  if (href) {
    const a = document.createElement('a');
    a.href = href;
    a.textContent = linkText || 'Otevřít';
    a.addEventListener('click', () => t.remove());
    t.append(a);
  }
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'koc-toast-close';
  close.setAttribute('aria-label', 'Zavřít oznámení');
  close.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  close.addEventListener('click', () => t.remove());
  t.append(close);
  host.append(t);
  setTimeout(() => t.remove(), href ? 9000 : 4500);
}
