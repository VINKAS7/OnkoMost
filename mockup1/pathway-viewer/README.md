# Diagnostic pathway viewer

A standalone web app that draws a pathway JSON as a flowchart (React Flow + dagre) and lets you mark, for one case,
which diagnostic steps are done, in progress, missing or in conflict. It then shows what is **missing and needed
before the MDT (red)** and what is **missing but not needed (grey)**. It has no backend and doesn't depend on the
Onkomost API.

```bash
cd mockup1/pathway-viewer
npm install
npm run dev      # http://localhost:5180, hot reload, re-reads ../seed/pathways/diagnostic/*.json
npm start        # production build + static server on :5180 (dist/ can be served by any web server)
```

Pathways are bundled from `mockup1/seed/pathways/diagnostic/*.json` (new format) and, read-only, the repo-root
`seed/pathways/*.json` (the full Onkomost pathways of the main backend). **Open JSON…** loads any other file. The case state is kept per pathway in the browser. **Export / Import
state** saves it as JSON, and **Link** copies a URL with the state (`#p=<pathway>&s=<base64 state>`).

## How to use

- **Click** a step to open it in the side panel; **double-click** cycles its status: missing → in progress → done → conflict.
- **Decisions** (purple): pick a branch in the panel. Rule decisions (`decided_by: "rule"`) choose themselves from the facts.
- **Facts** tab: set what is known about the patient (cirrhosis, CA 19-9, tumour size…). Facts drive conditions,
  requirement levels and rule decisions. A fact owned by a decision (e.g. `resectability`) is set by that decision.
- **Summary** tab: MDT readiness, the red list, counts and the file check (unknown nodes, branches or sources, cycles).

## Colours

| Step | Meaning |
|---|---|
| green | done / decided |
| blue dashed, animated edge | in progress (ordered or booked, no report yet) |
| **red dashed** | missing and **needed**: level `required`, blocking, condition true, on the patient's branch |
| grey dashed | missing but not needed (`recommended` / `optional` / `individual`, or `blocking: false`) |
| grey dotted `?` | not known yet: a fact or decision it depends on is still open |
| yellow | conflict between documents |
| teal | waived (e.g. histology after 2 non-diagnostic biopsies) |
| faded, struck through | not needed (condition false) or another branch was chosen |
| MDT, red / green border | waiting for N open items / ready |

A step whose sources are all `structure` (no `binding` ČOS text, no `local` rule) is shown as at most
`recommended`, so it can never turn red.

The logic is in `src/engine.ts` (pure functions, no UI), so it can be reused by the Onkomost backend or tests.
Limitation: the full pathways' `skip_if` field (e.g. "no anticoagulant") is not evaluated. Use a fact +
`condition` instead, as the diagnostic pathways do.

## Use in mockup1

`npm run export:mockup` copies `src/engine.ts` (as plain JS) to `mockup1/components/onco-dx-pathway/engine.js` and the
diagnostic pathways to `mockup1/data/dx-pathway-*.json`, where the standalone `<onco-dx-pathway>` web component (see
`mockup1/README_pathway.md`; wrapped by the prototype's `<dx-pathway>`) shows them on the GP, coordinator and MDT screens. Re-run it after changing the engine or a pathway.
