// ADME queries for <onco-anatomogram>: loads the pharmacolibrary ADME SQLite export with sql.js
// (lazily, once per page per URL) and computes, for a set of drugs, the tissues where each drug is
// absorbed / distributed / metabolised / excreted / acts, plus shared-actor interaction candidates.
// The query logic is ported from dbs-components-dev/src/pksites/adme-compute.js (<dbs-pksites>).

const HERE = new URL('.', import.meta.url);
export const DEFAULT_DB = new URL('data/adme-latest.json', HERE).href;
export const DEFAULT_SQL_WASM = new URL('vendor/sqljs/sql-wasm.js', HERE).href;

let sqlPromise = null;
const dbCache = new Map();

function loadScript(url) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`cannot load ${url}`));
    document.head.append(s);
  });
}

/** sql.js engine; the .wasm file is expected next to the loader script. */
function loadSql(sqlWasmUrl) {
  if (!sqlPromise) {
    sqlPromise = (async () => {
      if (!window.initSqlJs) await loadScript(sqlWasmUrl);
      const base = new URL('.', new URL(sqlWasmUrl, location.href)).href;
      return window.initSqlJs({ locateFile: (f) => base + f });
    })().catch((e) => { sqlPromise = null; throw e; });
  }
  return sqlPromise;
}

/**
 * Opens the database. `url` is either the .sqlite file or a JSON pointer {file, ...}
 * (adme-latest.json) whose `file` is resolved relative to the pointer.
 */
export function openDb(url = DEFAULT_DB, sqlWasmUrl = DEFAULT_SQL_WASM) {
  const abs = new URL(url, location.href).href;
  if (!dbCache.has(abs)) {
    dbCache.set(abs, (async () => {
      let fileUrl = abs;
      if (abs.endsWith('.json')) {
        const r = await fetch(abs);
        if (!r.ok) throw new Error(`${abs}: HTTP ${r.status}`);
        fileUrl = new URL((await r.json()).file, abs).href;
      }
      const [SQL, buf] = await Promise.all([
        loadSql(sqlWasmUrl),
        fetch(fileUrl).then((r) => {
          if (!r.ok) throw new Error(`${fileUrl}: HTTP ${r.status}`);
          return r.arrayBuffer();
        }),
      ]);
      return { db: new SQL.Database(new Uint8Array(buf)), file: fileUrl.split('/').pop() };
    })().catch((e) => { dbCache.delete(abs); throw e; }));
  }
  return dbCache.get(abs);
}

function q(db, sql, params = []) {
  const st = db.prepare(sql);
  st.bind(params);
  const out = [];
  while (st.step()) out.push(st.getAsObject());
  st.free();
  return out;
}

/** Resolves slugs, generic names or synonyms (case-insensitive) to adme_drug rows. */
export function resolveDrugs(db, names) {
  return names.map((name) => {
    const n = name.trim().toLowerCase();
    const r = q(db, `SELECT slug, generic_name AS name, drugbank_id, atc_codes FROM adme_drug
      WHERE lower(slug) = ? OR lower(generic_name) = ? LIMIT 1`, [n, n])[0]
      || q(db, `SELECT d.slug, d.generic_name AS name, d.drugbank_id, d.atc_codes FROM adme_synonym s
      JOIN adme_drug d ON d.slug = s.drug_slug WHERE lower(s.name) = ? LIMIT 1`, [n])[0];
    return r ? { ...r, query: name, atc: (r.atc_codes || '').split(',')[0] || '' } : { query: name, missing: true };
  });
}

const PERTURB = ['inhibitor', 'inducer'];

/**
 * For resolved drugs returns
 *   sites: [{ drug, process, tissue, uberon, genes[], evidence }]   (one row per drug·process·tissue)
 *   interactions: [{ kind: 'ddi_candidate'|'shared_substrate', gene, perpetrator, victim, effect, a, b, tissues: [{tissue, uberon}] }]
 * opts.evidence: actor evidence tiers to use (default ['drugbank_actor']); opts.text: include adme_text sites.
 */
export function computeAdme(db, drugs, { evidence = ['drugbank_actor'], text = true } = {}) {
  const siteOf = {};
  for (const r of q(db, 'SELECT gene, process, tissue, uberon FROM adme_site')) {
    (siteOf[r.gene] ||= []).push(r);
  }
  const acc = new Map(); // drug|process|tissue -> row
  const add = (drug, process, tissue, uberon, gene, ev) => {
    const k = `${drug}|${process}|${tissue}`;
    if (!acc.has(k)) acc.set(k, { drug, process, tissue, uberon, genes: [], evidence: [] });
    const row = acc.get(k);
    if (gene && !row.genes.includes(gene)) row.genes.push(gene);
    if (!row.evidence.includes(ev)) row.evidence.push(ev);
  };
  const byGene = {};
  const evList = evidence.map(() => '?').join(',');
  for (const d of drugs) {
    const actors = q(db, `SELECT gene, role, evidence FROM adme_actor WHERE drug_slug = ? AND evidence IN (${evList})`, [d.slug, ...evidence]);
    for (const a of actors) {
      for (const s of siteOf[a.gene] || []) add(d.slug, s.process, s.tissue, s.uberon, a.gene, a.evidence);
      ((byGene[a.gene] ||= {})[d.slug] ||= new Set()).add(a.role);
    }
    if (text) {
      for (const t of q(db, 'SELECT process, tissue, uberon FROM adme_text WHERE drug_slug = ?', [d.slug])) {
        add(d.slug, t.process, t.tissue, t.uberon, null, 'drugbank_text');
      }
    }
  }
  const interactions = [];
  for (const [gene, per] of Object.entries(byGene)) {
    const ds = Object.keys(per).sort();
    const tissues = (siteOf[gene] || []).map((s) => ({ tissue: s.tissue, uberon: s.uberon, process: s.process }));
    for (let i = 0; i < ds.length; i++) {
      for (let j = i + 1; j < ds.length; j++) {
        for (const [p, v] of [[ds[i], ds[j]], [ds[j], ds[i]]]) {
          const effect = [...per[p]].filter((r) => PERTURB.includes(r));
          if (effect.length && per[v].has('substrate')) {
            interactions.push({ kind: 'ddi_candidate', gene, perpetrator: p, victim: v, effect: effect.join('/'), tissues });
          }
        }
        if (per[ds[i]].has('substrate') && per[ds[j]].has('substrate')
          && !interactions.some((x) => x.gene === gene && [x.perpetrator, x.victim].includes(ds[i]) && [x.perpetrator, x.victim].includes(ds[j]))) {
          interactions.push({ kind: 'shared_substrate', gene, a: ds[i], b: ds[j], tissues });
        }
      }
    }
  }
  return { sites: [...acc.values()], interactions };
}
