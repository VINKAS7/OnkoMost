# Diagnostic pathways (draft)

`onkomost.diagnostic-pathway/0.1`: the diagnostic part only, from referral to the MDT gate. They belong to the
mockup1 prototype: `npm run export:mockup` in `mockup1/pathway-viewer/` copies them to `mockup1/data/dx-pathway-*.json`,
`mockup1/backend/dx_graph.py` imports them into Neo4j, and `mockup1/pathway-viewer/` is the editor/viewer. The main
backend's `backend/seed.py` does not load them.
They extend the existing node/edge format; the added fields are:

| Field | Where | Meaning |
|---|---|---|
| `sources` | top level | registry: title, url, edition, `fetched`, `checked` (`full_text` / `secondary` / `not_checked`) |
| `sources[]` | node | `{ref, role, section, quote \| note}`. `role`: **binding** (ČOS – decides required vs. optional), **structure** (NCCN/ESMO/NHS… – order, definitions), **local** (KOC practice) |
| `facts` | top level | patient facts used by rules: `bool` / `number` / `enum`, optional `derived` condition |
| `kind` | node | imaging, lab, procedure, histology, consult, staging, gate, milestone, intake, precaution |
| `level` | node | required, recommended, optional, individual, conditional (= required when `condition` holds) |
| `condition` | node | `{fact, eq\|in\|gt\|gte\|lt\|lte}`, combined with `all` / `any` / `not` |
| `level_rules` | node | `[{when, level}]`, first match wins (e.g. MDT required for BCLC 0–B, recommended for C) |
| `decided_by` | decision | `rule` (branch `when` conditions, `else`) or `clinician` (with a `suggest` hint) |
| `suppliable_by` | node | who else can supply the evidence, e.g. `["gp"]` (prior reports, labs, ECOG) – the GP screen lists only what the KOC arranges |
| `branch_in` | node | the step only exists on these branches |
| `waiver` | node | `{when, label, sources}`: requirement lifted (e.g. 2 non-diagnostic biopsies) |
| `branches` | edge | branch keys of a decision that this edge belongs to |
| `kind` | edge | sequence, parallel, conditional, branch |

Every `binding` quote is verbatim from the Modrá kniha ČOS 32 (checked against the chapter text on 2026-10-16).
`structure` sources marked `not_checked` / `secondary` must be read before the pathways are used clinically,
and all `sla_days` are placeholders.
