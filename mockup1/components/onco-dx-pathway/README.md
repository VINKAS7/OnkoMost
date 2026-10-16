# onco-dx-pathway

Standalone Web Component: draws a diagnostic pathway (`onkomost.diagnostic-pathway/0.1` JSON, from a file or from Neo4j via `/api/dx-pathways/<code>`) as a flowchart and colours each step from the case state — red = missing and needed for the MDT, grey = missing but not needed. Rule-based (`engine.js`), no AI.

```html
<script type="module" src="onco-dx-pathway/onco-dx-pathway.js"></script>
<onco-dx-pathway src="data/dx-pathway-pancreas.json" mode="full" lang="en" editable></onco-dx-pathway>
<script type="module">
  document.querySelector('onco-dx-pathway').state = { nodes: { ct_pancreas: 'done' }, decisions: {}, facts: { jaundice: true } };
</script>
```

Serve over HTTP. See `demo.html`, and the full documentation (attributes, state format, events, JSON format, Neo4j setup) in `README_pathway.md` at the prototype root.

Contents: `onco-dx-pathway.js` (element + styles), `engine.js` (**generated** from `pathway-viewer/src/engine.ts` by `npm run export:mockup`), `layout.js`, `i18n.js`, `demo.html`.
