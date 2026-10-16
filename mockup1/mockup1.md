# mockup1.md — Build prompt for Claude Code

> **How to use:** put this file in an empty folder, open Claude Code there and say:
> *"Read mockup1.md and build the app exactly as specified. Work through the Acceptance checklist at the end."*

---

## 0. Role and goal

You are building a **clickable, lightweight prototype** for the hackathon challenge **RAKATHON 2026 – „Cesta pacienta bez ztráty informací“** (VZP). It supports the **coordinator of a Comprehensive Oncology Centre (KOC)** and closes the information loop between the **referring doctor (GP)**, the **KOC coordinator** and the **VZP reviewing doctor (revizní lékař)**.

The demo walks **one case** (pan Josef Novák, 60 let, suspektní karcinom hlavy pankreatu) through four workflow steps:

| # | Step (CZ) | Meaning |
|---|---|---|
| 01 | **Převzít** | Take over existing documentation (FHIR / uploads) – no big new form |
| 02 | **Vytěžit** | AI extracts a structured handover + detects what is missing; doctor validates |
| 03 | **Koordinovat** | Coordinator dashboard: state, deadline, who is "na tahu" (owner of next step) |
| 04 | **Zpětná vazba** | MDT result goes back to GP with original context; reviewer is informed automatically; handover confirmed; case closed |

**AI only drafts – a human always confirms.** This principle must be visible in the UI.

---

## 1. Hard technical constraints

- **No build step, no bundler, no framework, no npm dependencies required to run.**
- **Docsify** is the only "backend": a static site that renders Markdown pages. Load docsify from CDN (`https://cdn.jsdelivr.net/npm/docsify@4`).
- Every screen is a **Markdown page** that composes **native Web Components** (Custom Elements v1, ES modules, Shadow DOM, `<template>`-free JS rendering is fine).
- Components are plain `.js` ES modules in `/components`, registered with `customElements.define`. No Lit, no React. (If you strongly need a helper, write a ~30-line `html` tagged-template helper yourself in `components/lib/html.js`.)
- Demo data = static JSON files in `/data`. Demo state changes (submit, confirm, close) are persisted in **`localStorage`** via a tiny store module so the flow works across pages and reloads. Provide a **"Reset demo"** button.
- Must run with either `npx docsify-cli serve .` **or** `python3 -m http.server` from the project root.
- UI language: **Czech** (`<html lang="cs">`). Code, comments, file names: English.
- Accessible: real `<button>`, `<input>` + `<label>`, `aria-label` on icon-only buttons, visible focus, text contrast ≥ 4.5:1, touch targets ≥ 44 px (small buttons ≥ 36 px), works at phone width (360 px) without horizontal page scroll.
- No emoji as icons — use inline stroke SVG icons (check, alert, copy, upload, arrow, send).

### Docsify gotchas (respect these)
- In Markdown pages, put custom element HTML **at column 0, with a blank line before and after** each HTML block; never indent HTML by 4+ spaces (Markdown would turn it into a code block).
- Custom elements upgrade automatically when docsify injects the page; components must therefore do all setup in `connectedCallback` and clean up listeners in `disconnectedCallback`.
- Pass complex data via a `src="data/…json"` attribute or via the store, **not** via JSON inside attributes.
- Use hash routing (docsify default). Hide the docsify sidebar on app screens (`hideSidebar` via a per-page class or a small docsify plugin) but keep it on the README/overview page.

---

## 2. File structure

```
/
├── index.html              # docsify config, loads components/index.js (type=module), theme.css
├── README.md               # overview page: challenge, 4 steps, links to 3 screens + "Reset demo"
├── _sidebar.md
├── gp.md                   # Screen 1 – Referující lékař (GP)
├── koordinator.md          # Screen 2 – Koordinátor KOC
├── revizni.md              # Screen 3 – Revizní lékař VZP
├── styles/theme.css        # design tokens (CSS custom properties) + page basics
├── components/
│   ├── index.js            # imports & registers all components
│   ├── lib/store.js        # localStorage store + 'koc:change' CustomEvent
│   ├── lib/html.js         # optional tiny template helper
│   ├── lib/icons.js        # inline SVG strings
│   ├── lib/llm.js          # LLM provider interface + mock provider (see §7)
│   ├── app-header.js
│   ├── case-tracker.js
│   ├── tt-bar.js
│   ├── fhir-picker.js
│   ├── doc-dropzone.js
│   ├── handover-panel.js
│   ├── missing-list.js
│   ├── confirm-send.js
│   ├── kpi-strip.js
│   ├── case-queue.js
│   ├── case-header.js
│   ├── task-plan.js
│   ├── msg-thread.js
│   ├── case-summary.js
│   ├── case-timeline.js
│   └── doc-list.js
└── data/
    ├── koc-list.json
    ├── fhir-bundle-novak.json     # mock FHIR R4 bundle returned by "IRIS"
    ├── handover-novak.json        # mock AI extraction result
    ├── template-pancreas.json     # task set + required fields (PlanDefinition-like)
    ├── queue.json                 # other patients in coordinator queue
    └── closed-cases.json          # reviewer list + Novák summary
```

---

## 3. Design system (put in `styles/theme.css` as CSS custom properties)

Calm, clinical, no gradients, no left-border cards.

| Token | Value | Use |
|---|---|---|
| `--bg` | `#F3F3EF` | page ground |
| `--surface` | `#FFFFFF` | cards |
| `--ink` | `#18212B` | text, header bar background |
| `--muted` | `#55606C` | secondary text |
| `--line` | `#DAD9D2` | borders |
| `--accent` | `#0E5A66` | primary buttons, active step |
| `--accent-soft` | `#E3EEEF` | "nový" pill, prefilled field tint `#F6F9F9` |
| `--ok` / `--ok-soft` | `#2D6A3E` / `#E5F1E7` | done, "aktivní" |
| `--warn` / `--warn-soft` | `#7A4200` / `#FCF1DE` | "odložený", "doplňte vy", partial |
| `--miss` / `--miss-soft` | `#94181A` / `#FBE9E7` | missing, "blokuje MDT", overdue |
| `--ai` / `--ai-soft` | `#3F347D` / `#ECEAF6` | anything AI-generated |

- Fonts: **IBM Plex Sans** (UI) + **IBM Plex Mono** (IDs, lab values, dates, endpoints) from Google Fonts.
- Radius 10 px cards, 8 px inputs/buttons, 999 px pills. Base font 15 px.
- Components read tokens through CSS variables (they inherit into Shadow DOM).
- Status is never color-only: always a text label in the pill.

**Pills used everywhere:** `nový`, `aktivní`, `odložený`, `po termínu`, `blokuje MDT`, `doplňte vy`, `doporučeno`, `AI návrh`, `potvrzen`, `převzato z FHIR`.

---

## 4. Shared components (spec)

### `<app-header role="gp|koordinator|revizni">`
Dark bar (`--ink`). Logo (pulse-line SVG) + product name **„Cesta pacienta“** (+ suffix „· KOC“ / „· revize“). Nav links per role. Right side: a pill with the **demo date** and the user name:
- gp: „Demo · 6. 1. 2026“ · „MUDr. Jana Dvořáková · praktický lékař, Benešov“; nav: Nové referování · Moji referovaní pacienti (4) · Zprávy z KOC (1)
- koordinator: „Demo · 12. 1. 2026“ · „Bc. Petra Malá · koordinátorka KOC VFN – HPB“; nav: Pracovní fronta · Kalendář MDT · Sady úkolů · Zprávy (3)
- revizni: „Demo · 27. 1. 2026“ · „MUDr. Tomáš Beneš · revizní lékař VZP“; nav: Uzavřené případy · Indikátory KOC · Moje dotazy
Also include a small role switcher (links to the 3 screens) so the demo can be driven from one window.

### `<case-tracker case-id="novak">` — the visualized workflow (on every screen)
Card titled „Cesta případu“. A 4-column grid (2×2 below 820 px) of step tiles **01 Převzít · 02 Vytěžit · 03 Koordinovat · 04 Zpětná vazba**. Each tile: numbered circle (✓ icon when done), title, one-line status text, optional pill. Tile states:
- `done` – green border/tint, ✓
- `done-with-issue` – amber tint, ✓ + amber pill (e.g. „chyběl 7 dní“)
- `active` – 2 px accent border
- `todo` – grey
Top-right summary pill: e.g. „5 údajů chybí · 2 blokují MDT“ (red) or „všechny kroky uzavřeny“ (green).
**State is derived from the store** (`case.phase`, `case.missing[]`, `case.tasks[]`) so it updates live as the demo progresses. Optional slot under the grid for `<tt-bar>`.

### `<tt-bar case-id="novak">`
Horizontal bar "Čas do léčby = T1 + T2 + T3": T1 (symptom → KOC), T2 (diagnostika → MDT), T3 (MDT → léčba). Segment widths ∝ days; done segments filled, current segment accent, remaining-to-target dashed, future grey. `role="img"` with a full `aria-label`.

---

## 5. Screens

### Screen 1 — `gp.md` · Referující lékař (demo moment 6. 1. 2026)

Page heading: label „Referování pacienta do komplexního onkologického centra“, H1 „Josef Novák, 60 let · suspektní tumor hlavy pankreatu“, right note „Koncept uložen 10:42 · vyplněno ručně jen **2 pole**“.

Then `<case-tracker>` (01 active „FHIR načten · 14 zdrojů + epikríza“, 02 active „AI návrh hotov · čeká na vaši kontrolu“ + pill „5 chybí“, 03/04 todo).

Two columns (stack on mobile):

**Left**
1. **Cílové centrum** – `<select>` from `koc-list.json`, default „VFN Praha – KOC · koordinace HPB (pankreas, játra, žlučové cesty)“; hint: „Doporučeno podle suspektní diagnózy C25 a spádovosti · případ přijde koordinátorovi, ne do e-mailu“.
2. **Pacient a referující lékař** (pill „převzato z FHIR“) – prefilled (tinted) inputs: Pacient, Rodné číslo `660105/••••` (mono, masked), Pojišťovna `111 – VZP ČR`, Telefon (masked). Only two manual fields: **Suspektní diagnóza** (`C25.0 – Zhoubný novotvar hlavy slinivky břišní (suspektní)`) and **Důvod a naléhavost**. Footer: referring doctor from profile.
3. **Dokumentace** – tabs `FHIR server` (selected) · `Nahrát soubory` · `Z ambulantního SW`.
   - `<fhir-picker endpoint="https://iris.ambulance-benesov.cz/fhir/r4" patient="Patient/8842" src="data/fhir-bundle-novak.json">`: green "Připojeno: InterSystems IRIS for Health" banner + „Načíst znovu“. List of found resources with checkboxes (all checked): Patient · Condition ×3 (R17 Ikterus, E11 DM 2. typu, I10 Hypertenze) · DiagnosticReport (UZ břicha 6. 1. 2026, pill „klíčové“) · Observation ×6 (Bilirubin, ALT, AST, GMT, ALP, CRP) · MedicationStatement ×2 · AllergyIntolerance (Penicilin) · DocumentReference (Epikríza.pdf).
   - `<doc-dropzone>`: dashed box „Další zprávy přetáhněte sem — PDF, DOCX, obrázek skenu · AI je zařadí do struktury“ + „Vybrat soubory“. Accept real files; list them; text-extract `.txt` only (others just listed) in the prototype.
   - The FHIR picker must actually `fetch()` the mock bundle JSON and render from it. Make the base URL configurable so a real IRIS FHIR endpoint can replace the mock later.

**Right**
4. `<handover-panel src="data/handover-novak.json" editable>` — header pill „AI návrh“, title „Strukturovaný handover“, „Šablona: karcinom pankreatu v1“. Sections, each with **Kopírovat** button (copies plain text to clipboard, shows „Zkopírováno“ for 2 s) and a **source line**:
   - Anamnéza a symptomy — „Ikterus od 5. 1. 2026, nebolestivý. Úbytek hmotnosti 4 kg za 2 měsíce. Acholická stolice, tmavá moč.“ — Zdroj: Epikríza.pdf, str. 1
   - Zobrazovací vyšetření — „UZ břicha 6. 1.: hypoechogenní ložisko v hlavě pankreatu cca 32 mm, dilatace intra- i extrahepatálních žlučových cest.“ — Zdroj: FHIR DiagnosticReport
   - Laboratoř (mono) — „Bilirubin 186 µmol/l ↑ · ALP 4,2 µkat/l ↑ · GMT 7,8 µkat/l ↑ · CRP 12 mg/l“ — Zdroj: FHIR Observation ×6
   - Komorbidity, medikace, alergie — „DM 2. typu, hypertenze · metformin 1000 mg 2×denně, ramipril 5 mg · alergie: penicilin“
   In editable mode the section text is a textarea-on-click.
5. `<missing-list case-id="novak" audience="gp">` — „Co v dokumentaci chybí“ (dle šablony pro 1. MDT). Items computed by **comparing `template-pancreas.json` required fields with the handover** (deterministic rule, not AI):
   - CT břicha s kontrastem (pankreatický protokol) — pill „blokuje MDT“ — „Zajistí KOC · nemusíte objednávat“
   - Histologie / cytologie — „blokuje MDT“ — „Zajistí KOC (ERCP / EUS)“
   - Výkonnostní stav (ECOG) — „doplňte vy“ — inline button group 0–4; choosing a value removes it from the list
   - CA 19-9, krevní obraz, koagulace — „doporučeno“ — „Pokud máte, přiložte · jinak doplní KOC“
6. `<confirm-send case-id="novak">` — checkbox „Zkontroloval(a) jsem návrh AI a údaje odpovídají dokumentaci.“; buttons „Uložit koncept“ and primary „Potvrdit a odeslat do KOC →“ (disabled until checkbox checked). Note: „AI pouze připravuje návrh · rozhoduje a potvrzuje lékař.“ On send: store `case.phase = 'submitted'`, record `provenance: {draftedBy: 'llm:<model>', verifiedBy: 'MUDr. Jana Dvořáková', at}`, show success toast with link to the coordinator screen.

### Screen 2 — `koordinator.md` · Koordinátor KOC (demo moment 12. 1. 2026)

`<kpi-strip>`: Nový 2 · Aktivní 7 · Odložený 3 · **Po termínu 1** (red card) · Medián času do MDT 8 dní.

Two columns: queue (≈360 px) + detail (flex).

`<case-queue src="data/queue.json">` — filter tabs (Vše 12 · Nový 2 · Aktivní 7 · Odložený 3, working). Cards show **name+age, state pill, dg + short context, „Další krok: X · termín“, „Na tahu: Y“**, optional missing count. Overdue first, then by deadline. Selected card has accent border. Cards:
- Karel Dušek, 68 — po termínu — C23 susp. tumor žlučníku — EUS + biopsie · termín byl 9. 1. — Na tahu: Gastroenterologie VFN
- **Josef Novák, 60** — aktivní — C25.0 · den 7 z cílových 14 — CT břicha · dnes 12. 1. — Na tahu: Radiologie VFN — „3 chybí“
- Marie Horáková, 72 — nový — C22.1 susp. cholangiokarcinom · od 11. 1. 16:20 — převzít a spustit sadu · do 13. 1. — Na tahu: vy (koordinátor)
- Petr Svoboda, 55 — aktivní — C24.1 — 1. MDT HPB · 13. 1. 14:00 — Na tahu: MDT HPB · podklady kompletní
- Eva Černá, 64 — odložený — C25.1 — čeká: histologie z ROC Kolín · do 14. 1. — Na tahu: Patologie, Nemocnice Kolín
If Novák was submitted on screen 1 in this browser and not yet taken over, show him as **nový** with button „Převzít a spustit sadu“ (applies `template-pancreas.json`, sets phase `active`).

Detail of the selected case:
- `<case-header>` — „Josef Novák, 60 let“, pills (state, masked RČ), line „C25.0 susp. · referoval(a) MUDr. Jana Dvořáková, PL Benešov · 6. 1. 2026 · hospitalizován Interna VFN“; buttons „Napsat lékaři“, „SMS pacientovi“, „+ Úkol“.
- `<case-tracker>` with `<tt-bar>`: 01 done, 02 done-with-issue („1 dotaz na lékaře otevřený“), 03 active („2 blokují MDT 13. 1.“), 04 todo. TT bar: T1 1 d (done), T2 6 d (running), „zbývá do cíle MDT 8 d“ (dashed), T3 –.
- `<task-plan case-id="novak">` — „Plán a úkoly“ (note „pořadí hlídá systém · notifikace 24 h před termínem“). Grid columns: status dot · Krok · Na tahu · Termín. Tasks from template with `dependsOn`:
  1. ✓ Převzetí, kontakt s pacientem — Koordinátor — 6. 1.
  2. ✓ Hospitalizace — Interna VFN — 7. 1.
  3. ✓ ERCP, stent do žlučových cest, odběr histologie — Gastroenterologie — 9. 1.
  4. ● **CT břicha a hrudníku – pankreatický protokol** (vysoká priorita · podmínka pro 1. MDT) — Radiologie VFN — dnes
  5. ● **Nádorové markery CA 19-9, CEA** (paralelně s CT) — Laboratoř VFN — dnes
  6. ○ Histologie z ERCP (podmínka pro 1. MDT) — Patologie VFN — 13. 1. 10:00
  7. ○ 1. MDT HPB (čeká na: CT, histologie, markery) — MDT HPB — 13. 1. 14:00
  8. ○ Závěr MDT → referující a revizní lékař (automaticky po nahrání zprávy) — Koordinátor — 14. 1.
  Clicking a running task's dot marks it done; a task whose `dependsOn` are not all done cannot be completed (show tooltip „Čeká na: …“). Overdue tasks get a red dot and „po termínu“ pill.
- Right column:
  - `<missing-list audience="koordinator">` — „Chybí 3“: CT břicha (MDT · úkol běží · Radiologie), Histologie (MDT · úkol běží · Patologie), ECOG (lékař · vyžádáno od MUDr. Dvořákové 6. 1. · bez odpovědi 6 dní · button „Připomenout“ → adds a message to thread).
  - `<handover-panel compact>` — „Handover od lékaře“ pill „potvrzen“; list of section names each with „Kopírovat“; „Originály: Epikríza.pdf · FHIR bundle (14 zdrojů)“.
  - `<msg-thread case-id="novak">` — messages: „Koordinátor → MUDr. Dvořáková · 6. 1.: Dobrý den, prosím o doplnění ECOG pana Nováka.“, „SMS → pacient · 11. 1.: CT 12. 1. v 8:30, Radiologie VFN, nalačno.“; input + „Odeslat“ (appends to store).
- **Step 04 action** (below the plan): `<mdt-upload>` (can be part of `task-plan` or its own small component) — „Nahrát zprávu z MDT“ → file input + mock **„AI: strukturovat závěr“** that fills a structured conclusion (diagnóza, závěr 1. MDT, závěr 2. MDT, plán léčby) for coordinator review → „Odeslat referujícímu a reviznímu lékaři“. Sets `case.phase = 'closed-pending-ack'`, then a simulated GP acknowledgement sets `closed` with timestamp „27. 1. 09:14“.

### Screen 3 — `revizni.md` · Revizní lékař VZP (demo moment 27. 1. 2026)

Two columns: list (≈340 px) + detail.

List „Nově předané z KOC“ (pill „3 nové“) from `closed-cases.json`:
- **Josef Novák, 60** — nový — C25.0 · KOC VFN · uzavřeno 27. 1. — Čas do léčby **21 dní** · 2× MDT
- Petr Svoboda, 55 — nový — C24.1 · uzavřeno 26. 1. — 17 dní · 1× MDT
- Eva Černá, 64 — dotaz otevřen — C25.1 · uzavřeno 22. 1. — 34 dní · čeká na odpověď koordinátora
- Jana Králová, 58 — zkontrolováno — C22.0 · KOC IKEM · uzavřeno 19. 1.

Detail:
- `<case-header>` — pills „předání potvrzeno“, „660105/•••• · VZP 111“; line „KOC VFN Praha – HPB · koordinátorka Bc. Petra Malá · referující MUDr. Jana Dvořáková (PL Benešov) · informace doručena automaticky 27. 1. 09:14“; buttons „Vyžádat doplnění“, primary „Označit jako zkontrolováno“.
- `<case-tracker>` all done; 02 done-with-issue „ECOG doplněn až 13. 1.“ pill „chyběl 7 dní“; 03 done-with-issue „8 úkolů · 2× MDT“ pill „1. MDT bez histologie“; 04 „PL potvrdil příjem 27. 1.“. Summary pill „všechny kroky uzavřeny“.
- Indicator tiles: **Čas do léčby 21 dní** (5. 1. symptom → 26. 1. operace) · **T1 1 den** · **T2 14 dní** (rozhodující 2. MDT 20. 1.) · **T3 6 dní** · **Úplnost podkladů 9/10 → 10/10** (1. MDT → 2. MDT). Compute these from the timeline data, don't hard-code.
- `<case-summary>` — pill „AI strukturace“, „Souhrn případu“, note „ze zpráv MDT a referování · ilustrativní data“. Rows (label | text + source): Diagnóza — C25.0 adenokarcinom hlavy pankreatu, resekabilní (Zpráva z 2. MDT) · 1. MDT 13. 1. — Histologie z ERCP neprůkazná → doplnit EUS s biopsií, znovu na MDT · 2. MDT 20. 1. — Resekabilní nález, indikace k pankreatoduodenektomii, poté zvážit adjuvantní léčbu · Léčba — 26. 1. operace, KOC VFN – Chirurgie · Vykázané výkony — „[kódy výkonů dle sazebníku – doplní tým s mentorem VZP]“ (keep as visible placeholder).
- `<case-timeline>` — 5. 1. Symptom – ikterus · 6. 1. Referování PL → KOC · 9. 1. ERCP, stent, histologie · 12. 1. CT, nádorové markery · **13. 1. 1. MDT – chyběla průkazná histologie** (amber dot) · 20. 1. 2. MDT – rozhodnutí · **26. 1. Operace – zahájení léčby** (accent dot) · 27. 1. Předání PL potvrzeno.
- `<doc-list>` — Zpráva z 1. MDT (13. 1.).pdf · Zpráva z 2. MDT (20. 1.).pdf · Operační protokol (26. 1.).pdf · Původní referování + handover (6. 1.).
- Question box: label „Dotaz na koordinátora“, textarea, „Odeslat dotaz“ → appends to the case's `msg-thread` (visible on the coordinator screen) and sets list pill to „dotaz otevřen“.

---

## 6. Data model (store + JSON) — FHIR-aligned names

Keep it simple JSON, but name things after FHIR so a real IRIS backend can replace it later:

```js
case = {
  id: 'novak',
  phase: 'draft' | 'submitted' | 'active' | 'postponed' | 'closed-pending-ack' | 'closed',
  serviceRequest: { koc, reasonCode: 'C25.0', note, requester },   // FHIR ServiceRequest
  patient: { name, birthNumberMasked, insurer: '111', phoneMasked },
  handover: { sections: [{ id, title, text, source }], provenance }, // FHIR Composition + Provenance
  missing: [{ id, label, severity: 'blocks-mdt'|'gp'|'recommended', owner, note, resolvedAt }],
  carePlan: { template: 'pancreas-v1' },                              // FHIR CarePlan from PlanDefinition
  tasks: [{ id, title, owner, due, priority, status: 'done'|'running'|'todo', dependsOn: [] }], // FHIR Task
  messages: [{ from, to, channel: 'app'|'email'|'sms', at, text }],   // FHIR Communication
  mdt: [{ date, conclusion }],
  timeline: { symptom, referral, mdtDecision, treatmentStart, ack }
}
```

`store.js` API: `getCase(id)`, `updateCase(id, patchFn)`, `reset()`, emits `window` event `koc:change` with `{id}`; components subscribe and re-render.

---

## 7. LLM layer (prototype = mock, but real interface)

`components/lib/llm.js` exports one **OpenAI-compatible** interface so the provider can later be WebLLM (in-browser), a local server (vLLM/Ollama with Qwen or gpt-oss) or a cloud model:

```js
export async function complete({ task, messages, jsonSchema }) // -> { content, model, latencyMs }
```

- `task` is one of: `classify-document`, `extract-handover`, `structure-mdt`, `summarize-for-reviewer`, `draft-message`.
- A `providers` map + `routing` config (`{ 'extract-handover': 'mock', 'draft-message': 'mock', ... }`) read from `window.KOC_CONFIG` in `index.html`.
- Implement **only the `mock` provider** now: returns the matching JSON from `/data` after an artificial 800 ms delay and reports `model: 'mock'`.
- Leave clearly marked stubs for `webllm` (dynamic `import('https://esm.run/@mlc-ai/web-llm')`, only used on koordinator/revizni screens, never on the GP screen) and `openai-compatible` (`fetch(baseUrl + '/v1/chat/completions')`).
- **Completeness check (`missing-list`) must NOT use the LLM** — it is a deterministic comparison with `template-pancreas.json`.
- Every AI output displayed with the `AI návrh` / `AI strukturace` pill and a source line; every confirm stores provenance.

---

## 8. Pages and docsify config

`index.html`:
- `window.$docsify = { name: 'Cesta pacienta', loadSidebar: true, auto2top: true, homepage: 'README.md', plugins: [hideSidebarOnAppPages] }`
- `<link>` docsify theme `vue.css` **plus** `styles/theme.css` (override docsify's `.markdown-section` max-width to 1440 px and padding on app pages).
- `<script type="module" src="components/index.js">` and docsify script.
- `window.KOC_CONFIG = { fhirBaseUrl: 'data/', llmRouting: {...} }`.

Each app page is mostly component tags, e.g. `koordinator.md`:

```markdown
<app-header role="koordinator"></app-header>

<kpi-strip src="data/queue.json"></kpi-strip>

<div class="layout-2col">
<case-queue src="data/queue.json" selected="novak"></case-queue>
<section class="detail">
<case-header case-id="novak" role="koordinator"></case-header>
<case-tracker case-id="novak"><tt-bar case-id="novak"></tt-bar></case-tracker>
<task-plan case-id="novak"></task-plan>
<missing-list case-id="novak" audience="koordinator"></missing-list>
<handover-panel case-id="novak" compact></handover-panel>
<msg-thread case-id="novak"></msg-thread>
</section>
</div>
```

`README.md`: short Czech intro (challenge, the 4 steps, "AI pouze připraví návrh → rozhoduje člověk"), links to the 3 screens in demo order, **Demo script** (below) and a „Reset demo“ button (`<demo-reset>` component).

---

## 9. Demo script (must work end to end in one browser)

1. Reset demo → open **GP**: FHIR resources load, AI handover appears after ~1 s, missing list shows 4 items; pick ECOG = 1 → it disappears; tick confirmation → send.
2. Open **Koordinátor**: Novák is in the queue as **nový** → „Převzít a spustit sadu“ → 8 tasks appear with owners and deadlines; tracker moves to step 03; mark CT and markers done; try to complete MDT before histology → blocked with „Čeká na: Histologie z ERCP“.
3. Complete histology & MDT tasks → upload MDT report → AI structures conclusion → coordinator edits/confirms → send.
4. Open **Revizní lékař**: Novák appears as nový with indicators (21 / 1 / 14 / 6 days), timeline with amber 1. MDT, AI summary; send a question → it appears in the coordinator's message thread.

(Steps 1–2 drive live state; to keep the hackathon demo robust, the koordinator and revizni pages also render the **pre-baked state for their demo date** when the store has no newer state.)

---

## 10. Acceptance checklist

- [ ] Runs with `python3 -m http.server` — no install, no build.
- [ ] Three app pages + README render via docsify; all UI is Web Components in Markdown.
- [ ] `<case-tracker>` appears on all three screens and reflects store state (done / issue / active / todo + missing summary).
- [ ] GP: only 2 manual fields; FHIR picker renders from JSON; handover sections copyable with source; missing list computed from template; send disabled until confirmation checkbox.
- [ ] Coordinator: queue with state, next step, deadline and **„Na tahu“** on every card; tabs filter; task dependencies enforced; overdue highlighted; messages persist.
- [ ] Step 04: MDT report upload → structured conclusion → sent to GP + reviewer → acknowledgement → case closed.
- [ ] Reviewer: indicators computed from timeline; AI summary with sources; question flows back to coordinator.
- [ ] Every AI output is labelled and confirmed by a human; provenance stored.
- [ ] LLM calls go only through `lib/llm.js`; no LLM on the GP page except the server/mock path; completeness check is rule-based.
- [ ] Phone width 360 px: no horizontal scroll, columns stack, tracker becomes 2×2.
- [ ] Keyboard: all actions reachable with Tab/Enter; focus visible.
- [ ] Czech UI copy exactly as above; all data clearly illustrative (anonymized/demo).

## 11. Out of scope for this iteration
Authentication, real email/SMS, real IRIS connection (keep the URL configurable), real WebLLM/local-LLM inference (stubs only), multiple diagnoses, production security. Next iteration: LLM benchmark harness using the same `llm.js` interface.
