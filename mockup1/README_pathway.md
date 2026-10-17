# `<onco-dx-pathway>`: diagnostic pathway of a case

`<onco-dx-pathway>` is a standalone Web Component (Custom Elements v1, Shadow DOM, ES modules). It needs no framework and no build step. It draws the **diagnostic pathway** of one cancer type as a flowchart, from referral through the examinations to the tumour board (MDT). It then colours every step by the **current state of a case**:

- **Red** (dashed) means the step is missing and needed for the MDT. It is required and blocking.
- **Grey** (dashed) means the step is missing but not needed: it is only recommended or optional, or it is backed only by a "structure" source.
- **Green** means done, **teal** means in progress, **amber** means unclear or a conflict, **violet** means the step is waiting for a clinician's decision, and **struck through** means not needed or on the other branch.

Every state has a text label, so status is never shown by colour alone.

You supply two things:

1. **The structure:** the pathway JSON (format `onkomost.diagnostic-pathway/0.1`). It can be a static file, or it can come from **Neo4j** through the backend (`/api/dx-pathways/<code>`). Both give the same JSON.
2. **The state:** which steps are done, in progress, missing or in conflict, which branch a decision took, and the case facts (jaundice, tumour size, …). The rules read these facts.

The element evaluates the pathway with a pure rule engine (`engine.js`) and works out which steps apply, how strongly each is needed, and what still blocks the MDT. **No AI is involved.** Every step's detail panel shows the reason for its state (condition, level rules, waiver, blockers) and the guideline sources, with verbatim quotes. The UI is in Czech (`lang="cs"`, the default) or English (`lang="en"`).

## Quick start

Copy the folder `components/onco-dx-pathway/` anywhere on a web server and use it like this:

```html
<script type="module" src="onco-dx-pathway/onco-dx-pathway.js"></script>

<onco-dx-pathway src="data/dx-pathway-pancreas.json" lang="en"></onco-dx-pathway>

<script type="module">
  const dx = document.querySelector('onco-dx-pathway');
  dx.state = {
    nodes: { referral: 'done', triage: 'done', ct_pancreas: 'in_progress' },
    decisions: {},
    facts: { jaundice: true, tumour_size_mm: 32 },
  };
  dx.addEventListener('dx-evaluated', (e) => console.log('missing for MDT:', e.detail.red));
</script>
```

Serve the page over HTTP (`python3 -m http.server`), because `file://` cannot `fetch` the JSON. A working playground is `components/onco-dx-pathway/demo.html`. It lets you pick a pathway, mode and language, edit the state by clicking, and watch the state JSON and the events. Open `http://localhost:8000/components/onco-dx-pathway/demo.html`. Query parameters override the defaults, for example `demo.html?src=/api/dx-pathways/ovary&mode=compact&lang=en` (needs the backend described below).

## Files

| File | Purpose |
|---|---|
| `onco-dx-pathway.js` | The element, with its styles included |
| `engine.js` | The rule engine. It is **generated** from `pathway-viewer/src/engine.ts` by `npm run export:mockup`, so do not edit it here |
| `layout.js` | Layered top-down layout (longest-path ranks, barycentre ordering), with no dependencies |
| `i18n.js` | Czech and English UI strings. Step labels come from the JSON (`label` / `label_en`) |
| `demo.html` | Playground |
| `README.md` | Short quick start |

The folder imports nothing from the prototype, so it can be copied into another app as it is.

## Attributes

| Attribute | Values | Meaning |
|---|---|---|
| `src` | URL | The pathway JSON to load: a file such as `data/dx-pathway-pancreas.json`, or the Neo4j-backed API `/api/dx-pathways/pancreas`. Changing it reloads the pathway. A response of the form `{ "pathway": {…} }` is unwrapped. |
| `state-src` | URL | Optional. Loads the case state from JSON, either `{nodes, decisions, facts}` or `{state: {…}, provenance: {…}}`. |
| `mode` | `full` (default), `compact`, `gp` | `full` shows the gap chips, the chart, the supportive-care chips and the legend. `compact` (for the MDT) shows progress, gaps, conflicts and the decisions that belong to the board, with the chart behind a "show full pathway" button. `gp` (for the referring doctor) shows only progress and what the cancer centre arranges itself. Steps with `owner_role: "gp"` or `suppliable_by: ["gp"]` are left out of that list. |
| `lang` | `cs` (default), `en` | UI language. Uses `label_en`, `name_en` and branch `label_en` when they exist. |
| `editable` | boolean | Lets the user change the state. Clicking a step opens its detail with status buttons (Missing, In progress, Done, Conflict, Clear choice), branch buttons for clinician decisions, and inputs for the facts that the step's rules read. Double-clicking a step cycles its status. Every change fires `dx-state-change`. Without `editable` the element is read-only and only the host sets the state. |
| `expanded` | boolean | In `compact` mode, shows the chart. The toggle button sets and removes this attribute. |
| `heading` | text | Replaces the card title ("Diagnostická cesta" / "Diagnostic pathway"). |
| `bare` | boolean | Drops the card border and padding when the host already provides a card. |

## Properties and methods

| Member | Meaning |
|---|---|
| `.pathway` (get/set) | The pathway object. Setting it overrides `src`. |
| `.state` (get/set) | The case state `{nodes, decisions, facts}`. The getter returns a copy. |
| `.provenance` (get/set) | Optional `{stepId: "text"}`, shown in the detail as "From the case". Use it to say where a status came from, for example `"CT abdomen 12. 1."`. |
| `.evaluation` (get) | The last engine result, `{nodes: {id: {vstate, level, cond, chosen, blockers, …}}, edges, red, warnings}`, or `null`. |
| `setStatus(id, status)` | `status` is `missing`, `in_progress`, `done`, `conflict`, or `null` to remove it. Throws on an unknown status. |
| `setDecision(id, keys)` | A branch key or an array of keys (`multi` decisions take several). `null` clears it. |
| `setFact(name, value)` | A boolean, number or enum string. `null` makes the fact unknown again. |
| `select(id)` | Opens the detail panel of a step. `null` closes it. |

## State format

```jsonc
{
  "nodes":     { "ct_pancreas": "done", "ca19_9": "in_progress", "histology": "conflict" },
  "decisions": { "resectability": ["borderline"] },
  "facts":     { "jaundice": true, "tumour_size_mm": 32, "on_anticoagulant": false }
}
```

- **`nodes`** holds what has happened to a step. A step that is not listed is *missing*. The engine turns this manual status into the visual state (`vstate`). A missing step becomes `missing_needed` (red) or `missing_optional` (grey) depending on its level. It becomes `skipped` when its condition is false, `pruned` when it lies on a branch that was not taken, and `undetermined` while a fact it depends on is unknown. A done step whose waiver holds becomes `waived`.
- **`decisions`** holds the branch key(s) chosen at a `decision` node. Decisions with `decided_by: "rule"` are taken from facts automatically. The others wait for a clinician or the MDT (`undecided`, violet).
- **`facts`** holds values for the facts declared in the pathway's `facts`. Derived facts are computed and never set.

The MDT step is `gate_ready` when nothing upstream blocks it, and `gate_waiting` otherwise. The blocking states are missing-needed, in progress, conflict and undecided. The end step counts as done only when no live upstream step is still open.

## Events

All events bubble and are `composed`, so they cross shadow roots.

| Event | `detail` | When |
|---|---|---|
| `dx-select` | `{id, node, eval}` | The user opens a step (click, Enter or Space). |
| `dx-state-change` | `{state, change: {type: 'status'\|'decision'\|'fact', id, value}}` | Any `setStatus` / `setDecision` / `setFact`, whether from editing or from code. Persist the state here. |
| `dx-evaluated` | `{evaluation, red, ready, progress: {done, total}}` | After every render. `ready` is true when nothing blocks the MDT. Do not set `.state` from this handler, or you create a render loop. |

## Styling

The element reads the prototype's theme tokens when they exist, and falls back to built-in colours otherwise: `--ink`, `--muted`, `--line`, `--line-strong`, `--surface`, `--bg`, `--accent(-soft)`, `--ok(-soft)`, `--warn(-soft)`, `--miss(-soft)`, `--ai(-soft)`, `--focus`, `--font-sans`, `--radius-card`, `--radius-ctl`. The `--dx-max-height` custom property (default `620px`) limits the height of the chart before it scrolls. Content in `slot="footer"` is shown at the bottom of the card.

## Pathway JSON (the structure)

The pathways live in `seed/pathways/diagnostic/*.json` (in this folder), with a full description in that folder's `README.md`. In short:

```jsonc
{
  "format": "onkomost.diagnostic-pathway/0.1",
  "code": "pancreas", "name": "Karcinom pankreatu – diagnostická cesta", "name_en": "…", "status": "draft",
  "sources": { "cos_mk32_c7": { "title": "Modrá kniha ČOS, 32. vydání – 7. …", "url": "https://www.linkos.cz/…", "default_role": "binding" } },
  "facts":   { "jaundice": { "type": "bool", "label": "Ikterus" }, "tumour_size_mm": { "type": "number", "unit": "mm", "label": "…" } },
  "graph": {
    "nodes": [
      { "id": "ct_pancreas", "type": "step", "kind": "imaging", "level": "required", "label": "CT – pankreatický protokol + CT hrudníku",
        "sources": [ { "ref": "cos_mk32_c7", "role": "binding", "section": "7.2", "quote": "…verbatim…" } ] },
      { "id": "biliary_drainage", "type": "step", "condition": { "fact": "jaundice", "eq": true },
        "level_rules": [ { "when": { "fact": "cholestasis", "eq": true }, "level": "recommended" } ] },
      { "id": "resectability", "type": "decision", "decided_by": "clinician",
        "branches": [ { "key": "resectable", "label": "resekabilní" }, { "key": "borderline", "label": "hraničně resekabilní" } ] }
    ],
    "edges": [ { "source": "ct_pancreas", "target": "resectability" }, { "source": "resectability", "target": "surgery", "branches": ["resectable"] } ]
  }
}
```

- **Node types:** `start`, `step`, `decision`, `mdt`, `end`.
- **Level:** `required`, `recommended`, `optional`, `individual` or `conditional`. `level_rules` can change it based on facts. A step whose sources are all `structure` is never red.
- **Applicability:** `condition` decides whether a step applies at all, and `branch_in` puts it on decision branches. `waiver` gives an explicit exception, and `blocking: false` keeps a step from blocking the MDT. Steps with `phase: "supportive"` are shown as chips beside the chart.
- **Conditions:** `{fact, eq|in|gt|gte|lt|lte}`, `{all: […]}`, `{any: […]}`, `{not: …}`, `{else: true}`.

The source link in the card header points to the binding source with a `url` that the steps cite most often.

After you change a pathway or `pathway-viewer/src/engine.ts`, run this in `pathway-viewer/`:

```
npm run export:mockup     # engine.ts → components/onco-dx-pathway/engine.js; pathways → data/dx-pathway-*.json
```

`pathway-viewer/` (`npm run dev`, port 5180) is the authoring tool for pathways. It uses the same engine, React Flow and validation, and keeps the state in a shareable link.

## Structure from Neo4j

The same JSON can be stored as a graph in the shared Neo4j and served by the prototype's backend (`backend/` in this folder). The element then needs only `src="/api/dx-pathways/<code>"`.

### Setup

All commands run from `mockup1/`. The short way is `scripts/setup.sh` once, then `scripts/start.sh`: it starts Neo4j, imports the pathways that are missing and serves everything on http://localhost:8000/ (`--viewer` adds the pathway viewer on :5180). Step by step:

```bash
scripts/setup.sh                 # .venv + backend/requirements.txt + backend/.env (once)
scripts/services.sh start        # Neo4j container onkomost-neo4j (password from backend/.env)
.venv/bin/python -m backend.dx_graph import seed/pathways/diagnostic/*.json
.venv/bin/python -m backend.dx_graph list
.venv/bin/uvicorn backend.app:app --port 8000          # prototype + GET /api/dx-pathways, /api/dx-pathways/{code}
```

The connection settings (`NEO4J_URI`, `NEO4J_USER`, `NEO4J_PASSWORD`) come from the environment or `backend/.env`. If an `onkomost-neo4j` container already exists, put its password there.

Other commands:

- `dx_graph export <code> [-o file.json]` writes a pathway back to JSON.
- `dx_graph check <files…>` imports the files, exports them again and compares the result. All three seed pathways come back **byte-identical**.

Importing a pathway replaces it completely, in one transaction.

The backend serves the prototype and the API from the same origin, so no CORS is needed: `src="/api/dx-pathways/pancreas"`. If Neo4j is not running, the endpoints answer 503.

### Graph model

The database is shared with another project. Every node carries the label **`:Onk`** plus a specific `OnkDx*` label, and the import and export only ever match and delete `:Onk:OnkDx*` nodes of that pathway code.

```
(:Onk:OnkDxPathway {code, name, name_en, status, icd_codes, …})
  -[:HAS_SOURCE {_order}]-> (:Onk:OnkDxSource {_pathway, _ref, title, url, edition, …})
  -[:HAS_FACT   {_order}]-> (:Onk:OnkDxFact   {_pathway, _name, type, label, unit, …})
  -[:HAS_STEP   {_order}]-> (:Onk:OnkDxStep   {_pathway, id, type, kind, level, label, …})
(:OnkDxStep) -[:NEXT  {_order, kind, label, branches, …}]-> (:OnkDxStep)
(:OnkDxStep) -[:CITES {_order, role, section, quote, note}]-> (:OnkDxSource)
(:OnkDxStep) -[:USES_FACT]-> (:OnkDxFact)      // which steps' rules read a fact; an index only, not exported
```

- Neo4j stores only primitives and lists of them. Other values, such as conditions, `level_rules`, `branches`, `waiver` and `requires`, are kept as JSON strings in a `json_<key>` property. `_keys` records the original key order, so the export reproduces the file exactly.
- Underscore-prefixed properties (`_pathway`, `_order`, `_ref`, `_name`, `_imported`) are graph bookkeeping and are not exported.

Useful queries:

```cypher
// steps that cite the ČOS chapter, with the quote
MATCH (s:Onk:OnkDxStep {_pathway:'pancreas'})-[c:CITES]->(src:Onk:OnkDxSource {_ref:'cos_mk32_c7'})
RETURN s.id, s.label, c.section, c.quote ORDER BY c.section;

// which steps change when the jaundice fact is known
MATCH (s:Onk:OnkDxStep)-[:USES_FACT]->(:Onk:OnkDxFact {_pathway:'pancreas', _name:'jaundice'}) RETURN s.id, s.label;

// everything downstream of CT
MATCH p = (:Onk:OnkDxStep {_pathway:'pancreas', id:'ct_pancreas'})-[:NEXT*]->(x) RETURN p;
```

In Python (from `mockup1/`), `from backend.dx_graph import import_dx_pathway, export_dx_pathway, list_dx_pathways` gives the same functions. Each takes an optional `store` (default: a `Neo4jStore` built from the settings above).

## Use in this prototype

`components/dx-pathway.js` (`<dx-pathway case-id mode>`) is a thin wrapper, like `mdt-anatomogram`:

- It loads `data/dx-map-<case>.json`, which names the pathway file and says how the case maps onto steps:
  - care-plan tasks → steps
  - values (ECOG) → step + fact
  - handover regexes
  - MDT record and "MDT issue" → conflict
  - diagnosis text → decision branch
- It computes the state with `lib/dx-case-state.js`.
- It sets `.state` and `.provenance` on an inner `<onco-dx-pathway>` whenever the case changes.

It is placed on three screens:

| Screen | Mode |
|---|---|
| Coordinator | `full` |
| MDT | `compact` |
| Referring doctor | `gp`, plus a footer pointing to "Co v dokumentaci chybí" |

The reviewer screen has none. A case without a map gets a "no pathway yet" note.

To feed the element from live data instead, map your own case records the same way and set `.state`. You can also persist the state that `editable` produces from `dx-state-change`.
