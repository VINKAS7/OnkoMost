# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Clickable hackathon prototype (RAKATHON 2026, VZP challenge "Cesta pacienta bez ztráty informací"). The main demo case — Josef Novák, suspected pancreatic head cancer — flows through four role screens: referring doctor (`gp.md`), KOC coordinator (`koordinator.md`), VZP reviewing doctor (`revizni.md`) and the tumour board (`mdt.md`, added after the original spec). `mockup1.md` is the original build spec (design tokens, component specs, data model, demo script, acceptance checklist) — consult it before changing behaviour; `README.md` is the in-app overview page with the demo script.

## Running

No build, no npm dependencies, no tests or linter. Serve the project root statically:

```
python3 -m http.server        # or: npx docsify-cli serve .
```

The GP screen's document scan (`<doc-gap-scan>`) additionally needs the optional FastAPI backend in `backend/` (see `backend/README.md`): `.venv/bin/uvicorn backend.app:app --port 8000` from this folder serves the prototype *and* `/api/doc-scan` (plus `/api/dx-pathways` from Neo4j). `scripts/setup.sh` creates `.venv` and `backend/.env`, `scripts/services.sh start` runs Neo4j in Docker. It reads the e-INFRA CZ API key from `einfracz.key` (gitignored, never served by `backend/app.py`, but `python3 -m http.server` would serve it, so don't use that while the key is present).

Opening `index.html` via `file://` fails (ES modules + `fetch` of `/data`). Demo state lives in `localStorage` key `koc-demo-v2`; use the "Reset demo" button on the overview page (`<demo-reset>`) to start over.

## Hard constraints (from the spec)

- Docsify (CDN) renders Markdown pages; every screen is a `.md` file composed of native Web Components. No frameworks (no Lit/React), no bundler.
- UI copy is **Czech**; code, comments and file names are English.
- In `.md` pages, custom-element HTML must start at column 0 with blank lines around each block (indenting 4+ spaces turns it into a code block). Pass complex data via `src="data/…json"` or the store, never JSON in attributes.
- "AI only drafts, a human confirms": every AI output shows an `AI návrh` / `AI strukturace` pill with a source line, and confirmations store provenance.
- The completeness check (`missing-list`, `derive.js#computeMissing`) is rule-based against `data/template-pancreas.json` — never route it through the LLM.
- All LLM calls go through `components/lib/llm.js`; no LLM use on the GP screen beyond the mock/server path.
- Accessibility: real buttons/labels, 44 px touch targets (36 px for `.btn.sm`), visible focus, no emoji icons (use `lib/icons.js` SVGs), status never color-only, no horizontal scroll at 360 px.

## Architecture

**Boot:** `index.html` defines `window.KOC_CONFIG` (FHIR base URL/mock flag, per-task LLM routing and provider settings) and `$docsify` (with a plugin that hides the sidebar on the app routes listed in its `APP` array — add new screens there). `components/index.js` awaits `initStore()` (loads the static JSON in `/data`), then dynamically imports every component listed in `COMPONENTS` — a new component must be added to that array and call `customElements.define` at the bottom of its file.

**Component base (`lib/base.js` → `KocElement`):** Shadow DOM with a shared base stylesheet plus a per-class `static styles` string; theme tokens come from `styles/theme.css` CSS variables. Rendering is full re-render: `render()` returns an `html\`\`` template (`lib/html.js`, auto-escapes unless `raw()`), assigned to `innerHTML`; focus/selection is restored for elements with `data-key`. Events are delegated: elements carry `data-action`, and the class implements `onClick(e, el, action)`, `onChange`, `onInput`, etc. Every component re-renders on the window `koc:change` event for its `case-id` (default `novak`). Use `this.listen()` for extra listeners so they are removed on disconnect.

**Cases (`lib/cases.js`):** registry of demo cases — `novak` (full flow from the GP screen, pancreas template) and `vesela` (Alena Veselá, suspected ovarian cancer, referred by a gynaecologist; starts as `submitted` in the coordinator queue, ovary template, no GP flow and no sample MDT report). Each entry names its template, initial factory, and which pre-baked factory a screen shows for a given stored phase. Templates are looked up per case with `templateFor(c)`; per-case texts come from `c.serviceRequest.requester/requesterOrg/requesterDat` and `c.patient.refGen/summary` — don't hard-code Novák or MUDr. Dvořáková in shared components. On `koordinator.md` and `mdt.md` components use `case-id="selected"`, resolved through `getSelected(screen)`; `<case-queue>` and `<case-picker>` call `setSelected`. Components with per-case UI state implement `caseChanged()` (called from `KocElement.update`). The revizni screen is still Novák-only.

**State (`lib/store.js`):** each case object (FHIR-aligned shape: `serviceRequest`, `handover`, `tasks`, `messages`, `mdt`, `timeline`, `phase`, …; see `mockup1.md` §6) persisted in `localStorage` (`koc-demo-v2`, together with the per-screen selection). Key behaviour: `getCase(id)` is **screen-dependent** — the koordinator and revizni screens show a pre-baked seed for their demo date (`seedActive` / `seedClosed` in `lib/seed.js`) until the live stored case has progressed that far (`isPrebaked`). So each screen works standalone, and `updateCase(id, fn)` by default patches a clone of *what the current screen shows* (pass `{ base: 'stored' }` to patch the live case). Phases: `draft → submitted → active → closed-pending-ack → closed`.

**Layers inside `components/lib/`:**
- `actions.js` — all domain mutations (submit referral, take over + apply care-plan template, complete task with dependency blocking, send MDT conclusion + simulated GP ack after 4 s, messages). Components call these rather than `updateCase` directly.
- `derive.js` — pure derivations: missing items, workflow step states for `case-tracker`, indicators/delays for the reviewer.
- `seed.js` — case factories, template application, actor names, fixed demo timestamps.
- `dates.js` — each screen has a fixed demo "today" (`DEMO_DATES`: gp 6. 1., koordinator 12. 1., mdt 13. 1., revizni 27. 1. 2026) derived from the hash route via `currentScreen()`; overdue/due labels use it, not the real clock.
- `llm.js` — `complete({ task, messages, jsonSchema })` / `completeJSON` with provider routing from `KOC_CONFIG.llmRouting`. Only `mock` is implemented (returns the matching `/data` JSON after a delay); `webllm` and `openai-compatible` are stubs.
- `data.js` (cached JSON/text fetch), `icons.js`, `toast.js`.

**Anatomogram:** `components/onco-anatomogram/` is a standalone Web Component (`<onco-anatomogram>`, no `KocElement`, own styles, cs/en) documented in `README_anatomogram.md`; keep it free of prototype imports so the folder stays copyable. It bundles the EBI drawings, sql.js and the pharmacolibrary ADME SQLite (`data/adme-*.sqlite`, 7.4 MB, loaded lazily only when a medication needs a lookup). `adme.js` ports `<dbs-pksites>`' query logic from `~/Projects/dbs-components-dev/src/pksites/adme-compute.js`. The prototype's `components/mdt-anatomogram.js` is only a wrapper: it sets `src="data/mdt-anatomogram-<case>.json"` (findings + medication list) and `reached` (`task:<id>` for done tasks, `mdt:<id>` for held MDTs). Drawings are regenerated with `python3 scripts/prune-anatomogram.py --sex male|female [--src homo_sapiens.<sex>.svg]`, adapted from `~/Projects/pharmacolibrary-dev/scripts/docs/prune-anatomogram.py`. Standalone check: `components/onco-anatomogram/demo.html`.

**Diagnostic pathway:** `components/onco-dx-pathway/` is a standalone Web Component (`<onco-dx-pathway>`, no `KocElement`, own styles, cs/en) documented in `README_pathway.md`; keep it free of prototype imports so the folder stays copyable. It takes the pathway JSON (`src` / `.pathway`; also served from Neo4j as `/api/dx-pathways/<code>` by `backend/app.py` + `backend/dx_graph.py`) and a case state (`.state` = `{nodes, decisions, facts}`, or `setStatus` / `setDecision` / `setFact`), draws an SVG flowchart (red = missing and needed for the MDT, grey = missing but not needed) and emits `dx-select` / `dx-state-change` / `dx-evaluated`; `editable` lets the user set statuses, decisions and facts. The rules live in `components/onco-dx-pathway/engine.js`, which is **generated**: edit `pathway-viewer/src/engine.ts` or `seed/pathways/diagnostic/*.json` (both in this folder; the viewer is a Vite + React authoring app on :5180), then run `npm run export:mockup` in `pathway-viewer/`. Standalone check: `components/onco-dx-pathway/demo.html`. The prototype's `components/dx-pathway.js` is only a wrapper: it loads `data/dx-map-<case>.json` (names the pathway file and maps the case's tasks / values / handover text / MDT record / diagnosis onto steps via `lib/dx-case-state.js`; Novák → pancreas, Veselá → ovary; a case without a map gets a "no pathway yet" note) and sets `.state` + `.provenance`. Modes: `mode="full"` on koordinator (the chart), `mode="compact"` on mdt (progress, gaps, decisions for the board, chart on demand), `mode="gp"` on gp (progress + what the KOC arranges; nodes with `suppliable_by: ["gp"]` are left to `missing-list`); none on revizni.

**Document scan (`<doc-gap-scan>`, GP screen):** the doctor uploads a PDF or DOCX, or the demo `data/demo/ambulantni-zprava-novak.pdf` generated by `scripts/make-demo-docs.py`. The component computes the case's open diagnostic-pathway steps (engine + `lib/dx-case-state.js`) and sends them with the file to `backend/` through `lib/llm.js#scanDocument`. It sends one request per model, so with "Porovnat oba" both models (`KOC_CONFIG.docScan.models`: GLM-5.3-flash, Qwen3.8-27B) fill their columns independently, followed by a comparison table (time, tokens, findings, verified quotes, agreement). The server checks every quote against the document text. Only items the doctor accepts are stored (`actions.js#acceptDocFinding` → `c.docFindings[stepId]`, plus `c.values.ecog` when the finding carries an ECOG fact). They count as done in the pathway (`dx-case-state.js`) and resolve the template fields linked by `dxStep` in `data/template-pancreas.json` (`derive.js#computeMissing`, `resolvedBy: 'document'`).
