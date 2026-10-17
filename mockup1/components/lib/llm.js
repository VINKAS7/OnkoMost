// LLM layer: one OpenAI-compatible interface, pluggable providers, routing from window.KOC_CONFIG.
// Prototype: only the `mock` provider is implemented. The completeness check never calls this.
import { currentScreen } from './dates.js';
import { loadJSON } from './data.js';

export const TASKS = ['classify-document', 'extract-handover', 'structure-mdt', 'summarize-for-reviewer', 'draft-message'];

const DEFAULT_ROUTING = Object.fromEntries(TASKS.map((t) => [t, 'mock']));
const config = () => window.KOC_CONFIG || {};
const routing = () => ({ ...DEFAULT_ROUTING, ...(config().llmRouting || {}) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lastUser = (messages) => [...messages].reverse().find((m) => m.role === 'user')?.content || '';

// --- mock provider --------------------------------------------------------
const MOCK = {
  'extract-handover': async () => loadJSON('data/handover-novak.json'),
  'structure-mdt': async (messages) => {
    let caseId = 'novak';
    try { caseId = JSON.parse(lastUser(messages)).caseId || caseId; } catch { /* plain-text prompt */ }
    return loadJSON(`data/mdt-structured-${caseId}.json`);
  },
  'summarize-for-reviewer': async () => (await loadJSON('data/closed-cases.json')).novak.summary,
  'classify-document': async (messages) => {
    const name = lastUser(messages).toLowerCase();
    const rules = [
      [/mdt|tumor ?board/, 'Zpráva z MDT', 'mdt'],
      [/\bct\b|ct[_ -]|\buz\b|uz[_ -]|rtg|mr[i_ -]|sono/, 'Zobrazovací vyšetření', 'imaging'],
      [/hist|cyto|pato/, 'Histologie / cytologie', 'histology'],
      [/lab|krev|bioch|marker/, 'Laboratoř', 'labs'],
      [/propou|epikr|zprav/, 'Lékařská zpráva', 'history'],
    ];
    const hit = rules.find(([re]) => re.test(name));
    return { category: hit ? hit[1] : 'Ambulantní zpráva', section: hit ? hit[2] : 'history', confidence: hit ? 0.86 : 0.55 };
  },
  'draft-message': async (messages) => {
    const { to, caseId = 'novak' } = JSON.parse(lastUser(messages) || '{}');
    if (caseId === 'prochazkova') {
      if (to === 'patient') return { text: 'Dobrý den, připomínáme termíny v KOC Nemocnice Lipová. Dotazy: koordinace GIT, tel. 241 000 650.' };
      return { text: 'Dobrý den, pane doktore, paní Procházková je převzata do KOC Nemocnice Lipová. CT zajistíme v KOC Nemocnice Severní, EUS-FNB u nás; MDT GIT plánujeme na 21. 10. Prosíme o doplnění výkonnostního stavu (ECOG 0–4) a konkrétní otázky na MDT.' };
    }
    if (caseId === 'vesela') {
      if (to === 'patient') return { text: 'Dobrý den, připomínáme vyšetření v KOC VFN. Termíny najdete v SMS od koordinátorky. Dotazy: koordinace gynekoonkologie, tel. 224 96• •••.' };
      if (to === 'reviewer') return { text: 'Dobrý den, k případu paní Veselé doplňujeme: ' };
      return { text: 'Dobrý den, paní doktorko, paní Veselá je převzata do KOC VFN. Nefrologie, CT a gynekoonkologické vyšetření 13. 1., MDT gynekoonkologie 15. 1. Děkujeme za kompletní podklady.' };
    }
    if (to === 'patient') return { text: 'Dobrý den, připomínáme vyšetření v KOC VFN. Termíny najdete v SMS od koordinátorky. Dotazy: koordinace HPB, tel. 224 96• •••.' };
    if (to === 'reviewer') return { text: 'Dobrý den, k případu pana Nováka doplňujeme: ' };
    return { text: 'Dobrý den, paní doktorko, pan Novák je převzat do KOC VFN, CT a nádorové markery dnes, 1. MDT plánováno na 13. 1. Prosíme o doplnění ECOG (0–4). Děkujeme.' };
  },
};

const providers = {
  mock: {
    async complete({ task, messages }) {
      const fn = MOCK[task];
      if (!fn) throw new Error(`mock: unknown task ${task}`);
      const [result] = await Promise.all([fn(messages), sleep(800)]);
      return { content: JSON.stringify(result), model: 'mock' };
    },
  },

  // --- STUB: in-browser inference (WebLLM). Never used on the GP screen. --------------
  webllm: {
    async complete({ messages, jsonSchema }) {
      if (currentScreen() === 'gp') throw new Error('webllm: not allowed on the GP screen (use server/mock path)');
      const model = config().llmProviders?.webllm?.model;
      throw new Error(`webllm: stub only in this prototype (model ${model})`);
      /* Next iteration:
      const webllm = await import('https://esm.run/@mlc-ai/web-llm');
      const engine = await webllm.CreateMLCEngine(model);
      const r = await engine.chat.completions.create({
        messages, response_format: jsonSchema ? { type: 'json_object', schema: JSON.stringify(jsonSchema) } : undefined,
      });
      return { content: r.choices[0].message.content, model };
      */
    },
  },

  // --- STUB: OpenAI-compatible server (vLLM / Ollama with Qwen or gpt-oss, or cloud). ---
  'openai-compatible': {
    async complete({ messages, jsonSchema }) {
      const { baseUrl, model, apiKey } = config().llmProviders?.['openai-compatible'] || {};
      if (!baseUrl) throw new Error('openai-compatible: baseUrl not configured');
      const res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify({
          model, messages, temperature: 0,
          ...(jsonSchema ? { response_format: { type: 'json_schema', json_schema: { name: 'out', schema: jsonSchema } } } : {}),
        }),
      });
      if (!res.ok) throw new Error(`openai-compatible: HTTP ${res.status}`);
      const j = await res.json();
      return { content: j.choices[0].message.content, model: j.model || model };
    },
  },
};

/** complete({ task, messages, jsonSchema }) -> { content, model, latencyMs } */
export async function complete({ task, messages = [], jsonSchema } = {}) {
  if (!TASKS.includes(task)) throw new Error(`llm: unknown task ${task}`);
  const name = routing()[task] || 'mock';
  const provider = providers[name];
  if (!provider) throw new Error(`llm: unknown provider ${name}`);
  const t0 = performance.now();
  const r = await provider.complete({ task, messages, jsonSchema });
  return { content: r.content, model: r.model, latencyMs: Math.round(performance.now() - t0) };
}

/** Convenience wrapper that parses JSON content. */
export async function completeJSON(opts) {
  const r = await complete(opts);
  return { ...r, data: JSON.parse(r.content) };
}

// --- document scan (server path: mockup1/backend, e-INFRA CZ OpenAI-compatible models) -----------------------
/** Ask one model on the prototype backend which of `items` (open pathway steps) the file documents. */
export async function scanDocument({ file, items, model, signal }) {
  const { url = '/api/doc-scan' } = config().docScan || {};
  const body = new FormData();
  body.append('file', file, file.name);
  body.append('items', JSON.stringify(items));
  body.append('models', model);
  let res;
  try { res = await fetch(url, { method: 'POST', body, signal }); }
  catch (e) { if (e.name === 'AbortError') throw e; throw new Error('backend nedostupný'); }
  if (res.status === 404 || res.status === 405 || res.status === 501) throw new Error('backend neběží (statický server)');
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.detail || `HTTP ${res.status}`);
  const r = j.results?.[0];
  if (!r) throw new Error('prázdná odpověď');
  if (r.error) throw new Error(r.error);
  return { ...r, file: j.file };
}
