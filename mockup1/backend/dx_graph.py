"""Diagnostic pathways (format onkomost.diagnostic-pathway/0.1) in Neo4j.

The JSON files in mockup1/seed/pathways/diagnostic/ are imported into the shared Neo4j as a graph and exported
back as the same JSON (same keys, same order, same values), which is what the <onco-dx-pathway> web component reads
(`src="/api/dx-pathways/<code>"`, served by backend/app.py). Like the rest of Onkomost every node carries the label
`Onk`; nothing outside `:Onk` is ever read, changed or deleted.

Connection: NEO4J_URI / NEO4J_USER / NEO4J_PASSWORD from the environment or mockup1/backend/.env
(defaults neo4j://localhost:7687, neo4j; scripts/setup.sh creates the .env, scripts/services.sh starts Neo4j).

Model
  (:Onk:OnkDxPathway {code, name, status, …})
  (pathway)-[:HAS_SOURCE {_order}]->(:Onk:OnkDxSource {_pathway, _ref, title, url, edition, …})
  (pathway)-[:HAS_FACT {_order}]->(:Onk:OnkDxFact {_pathway, _name, type, label, …})
  (pathway)-[:HAS_STEP {_order}]->(:Onk:OnkDxStep {_pathway, id, type, kind, level, label, …})
  (step)-[:NEXT {_order, kind, label, branches, …}]->(step)
  (step)-[:CITES {_order, role, section, quote, note}]->(source)
  (fact)<-[:USES_FACT]-(step)            convenience index: which steps' rules read a fact (not exported)

Properties that Neo4j cannot store natively (objects, lists of objects, nulls, empty or mixed lists) are kept as
JSON strings under `json_<key>`; `_keys` remembers the original key order. Run from mockup1/:

    .venv/bin/python -m backend.dx_graph import seed/pathways/diagnostic/*.json
    .venv/bin/python -m backend.dx_graph list
    .venv/bin/python -m backend.dx_graph export pancreas [-o pancreas.json]
    .venv/bin/python -m backend.dx_graph check seed/pathways/diagnostic/*.json   # import + export + compare
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

FORMAT = "onkomost.diagnostic-pathway/0.1"
PRIM = (str, int, float, bool)
# pathway keys stored as nodes / relationships rather than properties
STRUCTURAL = {"graph", "sources", "facts"}


def _is_prim(v) -> bool:
    return type(v) in PRIM


def _encode(d: dict, skip: set[str] = frozenset()) -> dict:
    """JSON object → Neo4j properties (+ `_keys` for the key order)."""
    props: dict = {"_keys": list(d)}
    for k, v in d.items():
        if k in skip:
            continue
        if _is_prim(v):
            props[k] = v
        elif isinstance(v, list) and v and all(_is_prim(x) for x in v) and len({type(x) for x in v}) == 1:
            props[k] = v
        else:
            props[f"json_{k}"] = json.dumps(v, ensure_ascii=False)
    return props


def _decode(props: dict, extra: dict | None = None) -> dict:
    """Neo4j properties → JSON object in the original key order; `extra` supplies the structural keys."""
    extra = extra or {}
    out = {}
    for k in props.get("_keys", []):
        if k in extra:
            out[k] = extra[k]
        elif k in props:
            out[k] = props[k]
        elif f"json_{k}" in props:
            out[k] = json.loads(props[f"json_{k}"])
    return out


def _cond_facts(c, out: set[str]) -> set[str]:
    if isinstance(c, dict):
        if isinstance(c.get("fact"), str):
            out.add(c["fact"])
        for x in (c.get("all") or []) + (c.get("any") or []):
            _cond_facts(x, out)
        _cond_facts(c.get("not"), out)
    return out


def _step_facts(n: dict) -> set[str]:
    out: set[str] = set()
    for c in [n.get("condition"), n.get("skip_if"), (n.get("waiver") or {}).get("when"),
              *[r.get("when") for r in n.get("level_rules") or []], *[b.get("when") for b in n.get("branches") or []]]:
        _cond_facts(c, out)
    return out


def check_pathway(p: dict) -> list[str]:
    """Structural problems that would make the import lossy or the graph inconsistent."""
    errs = []
    if not isinstance(p.get("code"), str) or not p["code"]:
        errs.append("missing pathway code")
    if p.get("format") not in (None, FORMAT):
        errs.append(f"unexpected format {p.get('format')!r}")
    nodes = (p.get("graph") or {}).get("nodes") or []
    edges = (p.get("graph") or {}).get("edges") or []
    ids = [n.get("id") for n in nodes]
    if len(ids) != len(set(ids)):
        errs.append("duplicate step ids")
    known = set(ids)
    for e in edges:
        if e.get("source") not in known or e.get("target") not in known:
            errs.append(f"edge {e.get('source')} → {e.get('target')} points to an unknown step")
    for n in nodes:
        for s in n.get("sources") or []:
            if not isinstance(s, dict) or "ref" not in s:
                errs.append(f"step {n.get('id')}: source without ref")
    return errs


# --- import ----------------------------------------------------------------------------------------------------

DELETE = """
MATCH (n:Onk)
WHERE (n:OnkDxPathway AND n.code = $code)
   OR ((n:OnkDxStep OR n:OnkDxSource OR n:OnkDxFact) AND n._pathway = $code)
DETACH DELETE n
"""


def _import_tx(tx, p: dict) -> dict:
    code = p["code"]
    tx.run(DELETE, code=code)
    props = _encode(p, STRUCTURAL)
    props["_imported"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    tx.run("CREATE (p:Onk:OnkDxPathway) SET p = $props", props=props)

    sources = [{"_ref": ref, "_order": i, "props": _encode(s)} for i, (ref, s) in enumerate((p.get("sources") or {}).items())]
    tx.run("""
        MATCH (p:Onk:OnkDxPathway {code: $code})
        UNWIND $rows AS r
        CREATE (s:Onk:OnkDxSource) SET s = r.props, s._pathway = $code, s._ref = r._ref
        CREATE (p)-[:HAS_SOURCE {_order: r._order}]->(s)""", code=code, rows=sources)

    facts = [{"_name": k, "_order": i, "props": _encode(f)} for i, (k, f) in enumerate((p.get("facts") or {}).items())]
    tx.run("""
        MATCH (p:Onk:OnkDxPathway {code: $code})
        UNWIND $rows AS r
        CREATE (f:Onk:OnkDxFact) SET f = r.props, f._pathway = $code, f._name = r._name
        CREATE (p)-[:HAS_FACT {_order: r._order}]->(f)""", code=code, rows=facts)

    graph = p.get("graph") or {}
    steps = [{"_order": i, "props": _encode(n, {"sources"})} for i, n in enumerate(graph.get("nodes") or [])]
    tx.run("""
        MATCH (p:Onk:OnkDxPathway {code: $code})
        UNWIND $rows AS r
        CREATE (n:Onk:OnkDxStep) SET n = r.props, n._pathway = $code
        CREATE (p)-[:HAS_STEP {_order: r._order}]->(n)""", code=code, rows=steps)

    cites = [{"id": n["id"], "ref": s["ref"], "_order": j, "props": _encode(s, {"ref"})}
             for n in graph.get("nodes") or [] for j, s in enumerate(n.get("sources") or [])]
    # a citation of a ref missing from the registry gets a bare source node (not exported into `sources`)
    tx.run("""
        UNWIND $rows AS r
        MATCH (n:Onk:OnkDxStep {_pathway: $code, id: r.id})
        MERGE (s:Onk:OnkDxSource {_pathway: $code, _ref: r.ref})
        CREATE (n)-[c:CITES]->(s) SET c = r.props, c._order = r._order""", code=code, rows=cites)

    edges = [{"s": e["source"], "t": e["target"], "_order": i, "props": _encode(e, {"source", "target"})}
             for i, e in enumerate(graph.get("edges") or [])]
    tx.run("""
        UNWIND $rows AS r
        MATCH (a:Onk:OnkDxStep {_pathway: $code, id: r.s}), (b:Onk:OnkDxStep {_pathway: $code, id: r.t})
        CREATE (a)-[x:NEXT]->(b) SET x = r.props, x._order = r._order""", code=code, rows=edges)

    uses = [{"id": n["id"], "fact": f} for n in graph.get("nodes") or [] for f in sorted(_step_facts(n))]
    tx.run("""
        UNWIND $rows AS r
        MATCH (n:Onk:OnkDxStep {_pathway: $code, id: r.id}), (f:Onk:OnkDxFact {_pathway: $code, _name: r.fact})
        MERGE (n)-[:USES_FACT]->(f)""", code=code, rows=uses)
    return {"code": code, "steps": len(steps), "edges": len(edges), "sources": len(sources), "facts": len(facts),
            "citations": len(cites)}


def ensure_schema(store) -> None:
    store.run("CREATE CONSTRAINT onkdxpathway_code IF NOT EXISTS FOR (n:OnkDxPathway) REQUIRE n.code IS UNIQUE")
    store.run("CREATE INDEX onkdxstep_id IF NOT EXISTS FOR (n:OnkDxStep) ON (n._pathway, n.id)")


def import_dx_pathway(p: dict, store=None) -> dict:
    """Replace the pathway `p["code"]` in Neo4j with `p`, in one transaction. Returns counts."""
    errs = check_pathway(p)
    if errs:
        raise ValueError(f"pathway {p.get('code')!r}: " + "; ".join(errs))
    store = store or _graph()
    ensure_schema(store)
    with store.driver.session(database="neo4j") as s:
        return s.execute_write(_import_tx, p)


# --- export ----------------------------------------------------------------------------------------------------

def export_dx_pathway(code: str, store=None) -> dict | None:
    """The pathway as JSON, identical to what was imported; None when it is not in Neo4j."""
    store = store or _graph()
    head = store.run("MATCH (p:Onk:OnkDxPathway {code: $code}) RETURN properties(p) AS p", code=code)
    if not head:
        return None
    sources = store.run("""
        MATCH (:Onk:OnkDxPathway {code: $code})-[r:HAS_SOURCE]->(s:Onk:OnkDxSource)
        RETURN s._ref AS ref, properties(s) AS props ORDER BY r._order""", code=code)
    facts = store.run("""
        MATCH (:Onk:OnkDxPathway {code: $code})-[r:HAS_FACT]->(f:Onk:OnkDxFact)
        RETURN f._name AS name, properties(f) AS props ORDER BY r._order""", code=code)
    steps = store.run("""
        MATCH (:Onk:OnkDxPathway {code: $code})-[r:HAS_STEP]->(n:Onk:OnkDxStep)
        OPTIONAL MATCH (n)-[c:CITES]->(s:Onk:OnkDxSource)
        WITH r, n, c, s ORDER BY c._order
        WITH r._order AS ord, n, [x IN collect({ref: s._ref, props: properties(c)}) WHERE x.ref IS NOT NULL] AS cites
        RETURN properties(n) AS props, cites ORDER BY ord""", code=code)
    edges = store.run("""
        MATCH (a:Onk:OnkDxStep {_pathway: $code})-[x:NEXT]->(b:Onk:OnkDxStep {_pathway: $code})
        RETURN a.id AS s, b.id AS t, properties(x) AS props ORDER BY x._order""", code=code)

    nodes = []
    for row in steps:
        cites = [_decode(c["props"], {"ref": c["ref"]}) for c in row["cites"]]
        nodes.append(_decode(row["props"], {"sources": cites}))
    graph = {"nodes": nodes, "edges": [_decode(e["props"], {"source": e["s"], "target": e["t"]}) for e in edges]}
    return _decode(head[0]["p"], {
        "graph": graph,
        "sources": {r["ref"]: _decode(r["props"]) for r in sources},
        "facts": {r["name"]: _decode(r["props"]) for r in facts},
    })


def list_dx_pathways(store=None) -> list[dict]:
    store = store or _graph()
    return store.run("""
        MATCH (p:Onk:OnkDxPathway)
        OPTIONAL MATCH (p)-[:HAS_STEP]->(n:Onk:OnkDxStep)
        RETURN p.code AS code, p.name AS name, p.name_en AS name_en, p.status AS status, p.icd_codes AS icd_codes,
               p._imported AS imported, count(n) AS steps
        ORDER BY code""")


# --- Neo4j connection (own, so mockup1 does not depend on the main Onkomost backend) ------------------------------

ENV_FILE = Path(__file__).resolve().parent / ".env"


def _setting(name: str, default: str = "") -> str:
    if os.getenv(name):
        return os.environ[name]
    if ENV_FILE.is_file():
        for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
            k, sep, v = line.partition("=")
            if sep and k.strip() == name:
                return v.strip().strip('"').strip("'")
    return default


class Neo4jStore:
    """Minimal driver wrapper: `run(query, **params)` → list of dicts, `driver` for write transactions."""

    def __init__(self, uri: str | None = None, user: str | None = None, password: str | None = None) -> None:
        self.uri = uri or _setting("NEO4J_URI", "neo4j://localhost:7687")
        self.user = user or _setting("NEO4J_USER", "neo4j")
        self.password = password if password is not None else _setting("NEO4J_PASSWORD")
        self._driver = None

    @property
    def driver(self):
        if self._driver is None:
            from neo4j import GraphDatabase
            self._driver = GraphDatabase.driver(self.uri, auth=(self.user, self.password), notifications_min_severity="OFF")
        return self._driver

    def run(self, query: str, **params) -> list[dict]:
        records, _, _ = self.driver.execute_query(query, params, database_="neo4j")
        return [r.data() for r in records]


_store: Neo4jStore | None = None


def _graph() -> Neo4jStore:
    global _store
    _store = _store or Neo4jStore()
    return _store


# --- CLI -------------------------------------------------------------------------------------------------------

def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python -m backend.dx_graph", description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("import", "check"):
        sp = sub.add_parser(name, help="import JSON files" if name == "import" else "import, export and compare")
        sp.add_argument("files", nargs="+", type=Path)
    ex = sub.add_parser("export", help="print / write one pathway as JSON")
    ex.add_argument("code")
    ex.add_argument("-o", "--out", type=Path)
    sub.add_parser("list", help="pathways stored in Neo4j")
    a = ap.parse_args(argv)

    if a.cmd == "list":
        for r in list_dx_pathways():
            print(f"{r['code']:<12} {r['steps']:>3} steps  {r['status'] or '':<8} {r['imported'] or ''}  {r['name']}")
        return 0
    if a.cmd == "export":
        p = export_dx_pathway(a.code)
        if p is None:
            print(f"pathway {a.code!r} is not in Neo4j", file=sys.stderr)
            return 1
        text = json.dumps(p, ensure_ascii=False, indent=2) + "\n"
        if a.out:
            a.out.write_text(text, encoding="utf-8")
        else:
            sys.stdout.write(text)
        return 0
    bad = 0
    for f in a.files:
        p = json.loads(f.read_text(encoding="utf-8"))
        print(f"{f}: {import_dx_pathway(p)}")
        if a.cmd == "check":
            back = export_dx_pathway(p["code"])
            same = json.dumps(back, ensure_ascii=False) == json.dumps(p, ensure_ascii=False)
            print(f"  round-trip {'identical' if same else 'DIFFERS'}")
            bad += not same
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
