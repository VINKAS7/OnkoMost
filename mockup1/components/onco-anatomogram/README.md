# onco-anatomogram

Standalone Web Component: an EMBL-EBI body drawing where red marks suspected cancer (from findings you supply) and blue marks organs affected by the patient's drugs. The drug sites are queried in the browser from the bundled pharmacolibrary ADME SQLite (sql.js).

```html
<script type="module" src="onco-anatomogram/onco-anatomogram.js"></script>
<onco-anatomogram lang="en" sex="female" drugs="tolvaptan, telmisartan"></onco-anatomogram>
```

Serve over HTTP. See `demo.html`, and the full documentation (attributes, board JSON, query rules, organ ids) in `README_anatomogram.md` at the prototype root.

Contents: `onco-anatomogram.js`, `adme.js`, `i18n.js`, `assets/` (drawings, CC BY 4.0), `vendor/sqljs/` (sql.js, MIT), `data/` (ADME database + `adme-latest.json` pointer).
