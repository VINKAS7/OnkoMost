# `<onco-anatomogram>` — anatomogram for tumour boards

A standalone Web Component (Custom Elements v1, Shadow DOM, ES modules; no framework, no build step) that draws a human body and colours its organs:

- **Red** shows suspicion of cancer, taken from the findings you supply (ultrasound → CT → histology → MDT). The grades are confirmed, suspected, cannot be excluded, secondarily affected and excluded.
- **Blue** shows organs where the patient's medication is absorbed, distributed, metabolised, excreted or acts. The element **queries the bundled pharmacolibrary ADME SQLite database** in the browser (sql.js) for the drugs you name.
- **Interaction candidates** are drug pairs that share a transporter or enzyme: an inhibitor or inducer of a gene paired with a substrate of it, or two substrates of the same gene.

Colouring is rule-based; no LLM is involved. The UI is in Czech (`lang="cs"`, default) or English (`lang="en"`).

The body drawing is the **EMBL-EBI Expression Atlas anatomogram** (CC BY 4.0), the same source as the pharmacolibrary `/sites` page and `<dbs-pksites>`. It is pruned to an oncology organ set that includes the pancreas, duodenum and female adnexa. Every organ is an SVG element whose `id` is its UBERON id.

## Quick start

Copy the folder `components/onco-anatomogram/` anywhere on a web server and use:

```html
<script type="module" src="onco-anatomogram/onco-anatomogram.js"></script>

<onco-anatomogram lang="en" sex="female"
  drugs="tolvaptan, telmisartan, hydrochlorothiazide, allopurinol">
</onco-anatomogram>
```

The page must be served over HTTP (`python3 -m http.server`), because `file://` cannot `fetch` the SVG or the database. A working example is `components/onco-anatomogram/demo.html` (open `http://localhost:8000/components/onco-anatomogram/demo.html`).

## Files

Everything the element needs lives in one folder. All default paths are resolved relative to the module (`import.meta.url`), so the folder can live anywhere.

| File | Size | Purpose |
|---|---|---|
| `onco-anatomogram.js` | | The element (styles included) |
| `adme.js` | | sql.js loader, database cache and ADME queries (ported from `<dbs-pksites>`' `adme-compute.js`) |
| `i18n.js` | | Czech / English strings, organ and tissue names, the tissue → drawing proxy table |
| `assets/anatomogram-hs-male.svg`, `assets/anatomogram-hs-female.svg` | 57 / 92 kB | Body drawings (EBI, CC BY 4.0) |
| `vendor/sqljs/sql-wasm.js`, `vendor/sqljs/sql-wasm.wasm` | 49 / 653 kB | sql.js (SQLite compiled to WebAssembly, MIT), copied from `pharmacolibrary-docs/assets/sqljs/` |
| `data/adme-latest.json` | | Pointer to the current database file (`{"file": "adme-828e638f90.sqlite", …}`) |
| `data/adme-828e638f90.sqlite` | 7.4 MB | pharmacolibrary ADME export (`pk_knowledge_scripts.export.adme_sqlite`), copied from `pharmacolibrary-docs/data/` |
| `README.md` | | Short quick start |
| `demo.html` | | Standalone demo |

Optional and outside the folder: `scripts/prune-anatomogram.py` regenerates the drawings (see *Adding organs*).

**When the database loads.** The 7.4 MB database and the 0.7 MB sql.js engine are fetched only when some medication needs a database lookup, and only once per page, however many elements there are. With static sites, or with no drugs at all, nothing is downloaded.

**Updating the database.** Copy a newer `adme-*.sqlite` from a pharmacolibrary build into `data/` and change `file` in `adme-latest.json`. Alternatively, point the `db` attribute at another location, such as the pharmacolibrary site's own `data/adme-latest.json`.

## Attributes

| Attribute | Description | Default |
|---|---|---|
| `drugs` | Comma-separated drugs to look up: slug, generic name or synonym, case-insensitive (`telmisartan`, `Micardis`). Merged with `medications` from the board data. | — |
| `sex` | Drawing: `male` or `female`. Overrides `sex` in the board data. | board `sex`, else `male` |
| `src` | URL of a board JSON with findings, medications and organ labels (see below). | — |
| `svg` | URL of a custom drawing; overrides `sex`. | bundled drawing |
| `db` | ADME database: a `.sqlite` file or a JSON pointer `{ "file": "…" }`, resolved relative to the pointer. | bundled `data/adme-latest.json` |
| `sql-wasm` | URL of `sql-wasm.js`; `sql-wasm.wasm` must sit next to it. | bundled `vendor/sqljs/sql-wasm.js` |
| `evidence` | Comma-separated actor evidence tiers to use: `drugbank_actor`, `paper_pgx`, `clinpgx_relation`, `clinpgx_label`, `clinpgx_annotation`. | `drugbank_actor` |
| `include-text` | `false` leaves out sites found only in the SPC text (`adme_text`). | `true` |
| `hide-tissues` | Comma-separated ADME tissues to ignore. The defaults are transporter expression rather than real drug sites; use `""` to show everything. | `blood-brain barrier, placenta, testis, mammary gland` |
| `lang` | `cs` or `en`. | `cs` |
| `zoom` | Initial view: `body` or `abdomen` (abdomen and pelvis). | `body` |
| `reached` | Space- or comma-separated steps the case has reached, e.g. `task:ct task:histology mdt:mdt2`. It gates findings that have a `when` (see *Findings*). If absent, every finding is shown. | — |

## Properties and events

```js
const el = document.querySelector('onco-anatomogram');
el.board = { findings: [...], medications: [...] };   // same shape as the src JSON; replaces src
el.reached = ['task:ct', 'mdt:mdt2'];                 // array or Set; null = show all findings
el.addEventListener('organ-select', (e) => console.log(e.detail)); // { organ: 'UBERON_0001264', label: 'pancreas' }
```

Changing any attribute or `board` reloads the element. Changing `reached`, `lang` or `zoom` only re-renders it. The layer, view and selected organ are internal UI state.

## Board data (`src` JSON or `board` property)

Every key is optional.

```jsonc
{
  "sex": "female",
  "zoomViewBox": "28 46 50 60",           // viewBox for the abdomen view (defaults per sex)
  "organs": {                             // label overrides; built-in Czech/English names are used otherwise
    "UBERON_0000992": "levé ovarium",
    "UBERON_0000029:7": "paraaortální uzliny"   // "ID:n" = only the n-th <path> of that organ group
  },
  "findings": [ ... ],
  "medications": [ ... ]
}
```

### Findings (red layer)

```jsonc
{
  "organ": "UBERON_0000992",       // organ key, or null for a site outside the drawing
  "label": "omentum / peritoneum", // needed for organ: null (shown as "not in drawing")
  "level": "suspect",              // confirmed | suspect | possible | related | excluded
  "date": "2026-01-13",
  "when": { "task": "ct" },        // optional gate: { "task": id } → "task:<id>", { "mdt": id } → "mdt:<id>", or a plain string key; null = always
  "text": "Solid-cystic adnexal tumour on the left, 78 mm",
  "source": "CT chest, abdomen and pelvis"
}
```

| `level` | Label (cs / en) | Drawing |
|---|---|---|
| `confirmed` | potvrzeno / confirmed | red fill |
| `suspect` | podezření / suspected | red fill |
| `possible` | nelze vyloučit / cannot be excluded | light red fill, dashed red outline |
| `related` | sekundárně postiženo / secondarily affected | dashed red outline (e.g. bile-duct obstruction) |
| `excluded` | vyloučeno / excluded | not coloured; listed with a green pill |

For each organ, the **last visible finding in array order** sets its state, so list findings chronologically. All of them appear in the organ's history panel. An organ with a red finding that is also a drug site gets a blue outline.

`when` + `reached` lets one data file follow a case over time. With `reached="task:ct"`, a finding whose `when` is `{ "task": "ct" }` appears and one with `{ "task": "histology" }` does not.

### Medications (blue layer)

```jsonc
"medications": [
  { "drug": "telmisartan", "label": "Telmisartan 80 mg", "dosage": "1× daily", "ref": "FHIR MedicationStatement/v2" }
]
```

`drug` is looked up in the database (slug, generic name or synonym). `label`, `dosage`, `ref` and `atc` are optional display fields; without them the element uses the generic name, the ATC code and the DrugBank id from the database. A drug that isn't found is shown with a "not found in the ADME database" pill.

**Static mode (no database).** Give a medication explicit `sites`, and that medication is not looked up:

```jsonc
{ "drug": "metformin", "label": "Metformin 1000 mg",
  "sites": [ { "organ": "UBERON_0002113", "process": "excretion", "genes": ["SLC22A2"] } ],
  "elsewhere": [ { "label": "skeletal muscle", "process": "distribution", "genes": ["SLC22A3"] } ] }
```

When every medication has `sites`, the database is never loaded. Static interactions can then be given in `drugs.interactions` (the legacy format of the earlier `mdt-anatomogram` JSON).

## What the database query does

For the resolved drugs (`adme_drug`, `adme_synonym`), `adme.js`:

1. Reads `adme_actor` rows (drug → gene, role, evidence) at the chosen evidence tiers. It joins them with `adme_site` (gene → process, tissue, UBERON) to get **drug · process · tissue · genes**.
2. If `include-text` is on, adds `adme_text` sites (process and tissue stated in the SPC text, with no gene).
3. Builds interaction candidates gene by gene. A pair is a `ddi_candidate` when one drug is an `inhibitor`/`inducer` and the other a `substrate` of the gene, and a `shared_substrate` when both are substrates. Interactions use the same actor rows, i.e. those that passed the `evidence` filter. The organs listed for an interaction are the gene's sites.
4. Maps tissues to the drawing. A tissue's UBERON id becomes the organ id, with proxies for tissues the drawing lacks: bile duct → gall bladder, ileum → small intestine, mammary gland → breast. Tissues in `hide-tissues` are dropped. Tissues absent from the drawing (blood, skeletal muscle, skin, …) appear as dashed "not in drawing" chips.

The ADME tissue vocabulary has 22 tissues: adipose tissue, adrenal gland, bile duct, blood, blood-brain barrier, brain, heart, ileum, kidney, liver, lung, mammary gland, neuromuscular junction, ovary, placenta, platelet, prostate gland, skeletal muscle, skin, small intestine, stomach and testis.

## Organs in the drawings

| Organ id | cs / en | Drawing |
|---|---|---|
| `UBERON_0000955` | mozek / brain | both |
| `UBERON_0001043` | jícen / esophagus | both |
| `UBERON_0002048` | plíce / lung | both |
| `UBERON_0000948` | srdce / heart | both |
| `UBERON_0002107` | játra / liver | both |
| `UBERON_0002106` | slezina / spleen | both |
| `UBERON_0000945` | žaludek / stomach | both |
| `UBERON_0001155` | tlusté střevo / colon | both |
| `UBERON_0002108` | tenké střevo / small intestine | both |
| `UBERON_0001255` | močový měchýř / urinary bladder | both |
| `UBERON_0002113` | ledviny / kidney | both |
| `UBERON_0002369` | nadledviny / adrenal gland | both |
| `UBERON_0002110` | žlučník a žlučové cesty / gall bladder and bile ducts | both |
| `UBERON_0002114` | duodenum | both |
| `UBERON_0001264` | pankreas / pancreas | both |
| `UBERON_0002367` | prostata / prostate gland | male |
| `UBERON_0000977` | pleura | female |
| `UBERON_0000310` | prsy / breast | female |
| `UBERON_0000029` | lymfatické uzliny / lymph nodes (`:7` = para-aortic) | female |
| `UBERON_0000995` | děloha / uterus | female |
| `UBERON_0003889` | vejcovody / fallopian tubes | female |
| `UBERON_0000992` | ovaria / ovaries | female |

### Adding organs

The upstream EBI drawings contain about 80 organs (thyroid `UBERON_0002046`, rectum `UBERON_0001052`, bone marrow `UBERON_0002371`, …). To add one, add its id to `KEEP` in `scripts/prune-anatomogram.py` and regenerate:

```bash
python3 scripts/prune-anatomogram.py --sex male   [--src ~/…/homo_sapiens.male.svg]
python3 scripts/prune-anatomogram.py --sex female [--src ~/…/homo_sapiens.female.svg]
# without --src the pinned upstream commit is downloaded from GitHub
```

Then add its name to `ORGANS` in `i18n.js`, or label it in the board's `organs`. List order is draw order: organs that lie behind others in the front view come later, so they stay visible when coloured.

## Styling

The element carries its own styles and reads these CSS custom properties from the page, with built-in fallbacks:

```css
--tumor  #C62828;  --tumor-soft  #F4B4AE;     /* red layer */
--drug   #1B57AE;  --drug-soft   #E3EDFB;     /* blue layer */
--ink, --muted, --line, --line-strong, --surface, --bg, --accent, --accent-soft,
--ok, --ok-soft, --warn, --warn-soft, --miss, --miss-soft,
--font-sans, --font-mono, --radius-card, --radius-ctl
```

## Use in this prototype

`mdt.md` uses the wrapper `<mdt-anatomogram case-id="selected" zoom="abdomen">` (`components/mdt-anatomogram.js`). The wrapper creates one `<onco-anatomogram lang="cs">`, sets `src="data/mdt-anatomogram-<case>.json"`, and keeps `reached` in sync with the case: every finished task becomes `task:<id>` and every held MDT becomes `mdt:<id>`. The two board files (`data/mdt-anatomogram-novak.json`, `data/mdt-anatomogram-vesela.json`) hold the findings and the medication list; the organ sites and interactions come from the database.

## Licences and attribution

- Body drawings: EMBL-EBI Expression Atlas anatomogram (https://github.com/ebi-gene-expression-group/anatomogram), CC BY 4.0, pinned commit `9fcc37022cce1e2862692a5f5fbfb78572b87e67`. The figure caption carries the attribution; keep it.
- sql.js: MIT licence (https://github.com/sql-js/sql.js).
- ADME database: a pharmacolibrary export built from DrugBank and literature sources; check the pharmacolibrary project's terms before redistributing it outside this prototype.
- All patient data in this prototype's `data/` folder is illustrative.
