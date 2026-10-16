import { KocElement } from './lib/base.js';
import { html } from './lib/html.js';
import { icon } from './lib/icons.js';
import { getCase } from './lib/store.js';
import { addUploads, patchUpload, removeUpload } from './lib/actions.js';
import { completeJSON } from './lib/llm.js';

// Accepts real files. Prototype: text is extracted from .txt only, others are just listed.
const kb = (n) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} kB` : `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`);

class DocDropzone extends KocElement {
  static styles = `
    .zone { border: 2px dashed var(--line-strong); border-radius: var(--radius-card); padding: 20px 16px; display: grid; justify-items: center;
      gap: 10px; text-align: center; background: #FAFAF8; }
    .zone.over { border-color: var(--accent); background: var(--accent-soft); }
    .zone .icon { width: 28px; height: 28px; color: var(--accent); }
    .zone p { max-width: 46ch; }
    ul { margin-top: 12px; display: grid; gap: 8px; }
    li { border: 1px solid var(--line); border-radius: var(--radius-ctl); padding: 10px 12px; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 10px; align-items: start; }
    .name { font-weight: 600; overflow-wrap: anywhere; }
    .meta { font-size: 13px; color: var(--muted); display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin-top: 2px; }
    .preview { margin-top: 6px; font-family: var(--font-mono); font-size: 12px; color: var(--muted); white-space: pre-wrap; overflow-wrap: anywhere;
      max-height: 6.5em; overflow: hidden; background: var(--bg); border-radius: 6px; padding: 6px 8px; }
    .rm { min-width: 36px; padding: 0; }
    input[type="file"] { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
  `;

  render() {
    const c = getCase(this.caseId);
    const uploads = c.uploads || [];
    const locked = c.phase !== 'draft';
    return html`
      <div class="zone" data-action="zone">
        ${icon('upload')}
        <p><strong>Další zprávy přetáhněte sem</strong> — PDF, DOCX, obrázek skenu · AI je zařadí do struktury</p>
        <input id="file" type="file" multiple accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,.tif,.tiff" data-action="files" tabindex="-1" aria-hidden="true">
        <button class="btn sm" type="button" data-action="pick" ${locked ? 'disabled' : ''}>${icon('upload')}Vybrat soubory</button>
      </div>
      ${uploads.length ? html`<ul aria-label="Nahrané soubory">
        ${uploads.map((u) => html`<li>
          ${icon('file')}
          <div>
            <div class="name">${u.name}</div>
            <div class="meta">
              <span class="mono">${kb(u.size)}</span>
              ${u.status === 'classifying' ? html`<span class="pill ai">AI zařazuje…</span>` : ''}
              ${u.category ? html`<span class="pill ai">${icon('spark')}AI návrh: ${u.category}</span>` : ''}
              ${u.text == null && u.status !== 'classifying' ? html`<span>text se v prototypu nevytěžuje</span>` : ''}
            </div>
            ${u.text ? html`<div class="preview">${u.text}</div>` : ''}
          </div>
          <button class="btn sm ghost rm" type="button" data-action="remove" data-id="${u.id}" aria-label="Odebrat soubor ${u.name}" ${locked ? 'disabled' : ''}>${icon('x')}</button>
        </li>`)}
      </ul>` : ''}`;
  }

  async addFiles(fileList) {
    if (getCase(this.caseId).phase !== 'draft') return;
    const files = [...fileList];
    const metas = await Promise.all(files.map(async (f) => ({
      id: Math.random().toString(36).slice(2, 9), name: f.name, size: f.size, type: f.type,
      text: /\.txt$/i.test(f.name) ? (await f.text()).slice(0, 600) : null,
      status: 'classifying',
    })));
    addUploads(this.caseId, metas);
    for (const m of metas) {
      completeJSON({ task: 'classify-document', messages: [{ role: 'user', content: m.name + (m.text ? '\n' + m.text.slice(0, 200) : '') }] })
        .then((r) => patchUpload(this.caseId, m.id, { category: r.data.category, section: r.data.section, model: r.model, status: 'done' }))
        .catch(() => patchUpload(this.caseId, m.id, { status: 'error' }));
    }
  }

  onClick(e, el, action) {
    if (action === 'pick') this.$('#file').click();
    if (action === 'remove') removeUpload(this.caseId, el.dataset.id);
  }

  onChange(e, el, action) {
    if (action === 'files' && el.files.length) { this.addFiles(el.files); el.value = ''; }
  }

  onDragover(e, el, action) {
    if (action !== 'zone') return;
    e.preventDefault();
    el.classList.add('over');
  }

  onDragleave(e, el, action) { if (action === 'zone') el.classList.remove('over'); }

  onDrop(e, el, action) {
    if (action !== 'zone') return;
    e.preventDefault();
    el.classList.remove('over');
    if (e.dataTransfer?.files?.length) this.addFiles(e.dataTransfer.files);
  }
}
customElements.define('doc-dropzone', DocDropzone);
