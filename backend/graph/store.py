"""Neo4j patient graph.

The Neo4j database is shared with another project, so every Onkomost node carries the label `Onk` plus a
specific `Onk*` label, and every query here is scoped to those labels. Nothing outside `:Onk` is ever read,
changed or deleted.

Model
  (:Onk:OnkPatient {uuid})
  (:Onk:OnkDocument {uid, type, date, title, facility, author})-[:ABOUT]->(patient)
  (doc)-[:FROM]->(:Onk:OnkFacility) · (doc)-[:AUTHORED_BY]->(:Onk:OnkDoctor)
  (patient)-[:HAS]->(fact:Onk:OnkCondition|OnkMedication|OnkExam|OnkLabResult|…)-[:STATED_IN {quote,match,method}]->(doc)
  (patient)-[:HAS_FLAG]->(:Onk:OnkFlag)-[:RAISED_ON]->(doc)
"""
from __future__ import annotations

from datetime import date
from typing import Any

from neo4j import GraphDatabase

from backend.config import settings

LABELS = {
    "patient": "OnkPatient", "condition": "OnkCondition", "medication": "OnkMedication", "allergy": "OnkAllergy",
    "symptom": "OnkSymptom", "exam": "OnkExam", "lab": "OnkLabResult", "measurement": "OnkMeasurement",
    "diagnosis": "OnkDiagnosis", "contact_person": "OnkContactPerson", "referring_doctor": "OnkReferringDoctor",
    "mentioned_exam": "OnkMentionedExam", "precaution": "OnkPrecaution", "note": "OnkNote",
    "mdt_question": "OnkMdtQuestion", "epikriza": "OnkEpikriza", "node_match": "OnkNodeMatch",
}
# Facts of these kinds are merged across documents (one node, many STATED_IN sources).
MERGED_KINDS = {"condition", "medication", "allergy", "symptom", "contact_person", "referring_doctor"}


def _native(v):
    """neo4j.time.Date/DateTime → Python date/datetime, recursively."""
    if hasattr(v, "to_native"):
        return v.to_native()
    if isinstance(v, dict):
        return {k: _native(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_native(x) for x in v]
    return v


def _clean(props: dict) -> dict:
    """Neo4j properties must be primitives / dates / lists of primitives."""
    out = {}
    for k, v in props.items():
        if v is None or isinstance(v, (str, int, float, bool, date)):
            out[k] = v
        elif isinstance(v, list) and all(isinstance(i, (str, int, float, bool)) for i in v):
            out[k] = v
        else:
            out[k] = str(v)
    return out


class GraphStore:
    def __init__(self) -> None:
        self._driver = None

    @property
    def driver(self):
        if self._driver is None:
            self._driver = GraphDatabase.driver(settings.neo4j_uri, auth=(settings.neo4j_user, settings.neo4j_password),
                                                notifications_min_severity="OFF")
        return self._driver

    def run(self, query: str, **params) -> list[dict]:
        records, _, _ = self.driver.execute_query(query, params, database_="neo4j")
        return [_native(r.data()) for r in records]

    def ping(self) -> str:
        comp = self.run("CALL dbms.components() YIELD name, versions RETURN name, versions[0] AS v")
        onk = self.run("MATCH (n:Onk) RETURN count(n) AS c")[0]["c"]
        return f"{comp[0]['name']} {comp[0]['v']}, {onk} Onkomost nodes"

    def ensure_schema(self) -> None:
        for label, prop in [("OnkPatient", "uuid"), ("OnkDocument", "uid"), ("OnkFacility", "name"), ("OnkDoctor", "name")]:
            self.run(f"CREATE CONSTRAINT {label.lower()}_{prop} IF NOT EXISTS FOR (n:{label}) REQUIRE n.{prop} IS UNIQUE")
        for label in [*LABELS.values(), "OnkChunk", "OnkFlag"]:
            if label != "OnkPatient":
                self.run(f"CREATE CONSTRAINT {label.lower()}_id IF NOT EXISTS FOR (n:{label}) REQUIRE n.id IS UNIQUE")
        from backend.rag.ask import ensure_index
        ensure_index()

    # -- writes ----------------------------------------------------------------------------------
    def write_document(self, patient_uuid: str, doc_uid: str, meta: dict, facts: list[dict], flags: list[dict],
                       chunks: list[dict] | None = None) -> None:
        def tx(t):
            t.run("MERGE (p:Onk:OnkPatient {uuid: $uuid})", uuid=patient_uuid)
            t.run("""
                MATCH (p:OnkPatient {uuid: $uuid})
                MERGE (d:Onk:OnkDocument {uid: $uid}) SET d += $meta
                MERGE (d)-[:ABOUT]->(p)
                WITH d
                CALL (d) { WITH d WHERE $facility <> ''
                    MERGE (f:Onk:OnkFacility {name: $facility}) MERGE (d)-[:FROM]->(f) }
                CALL (d) { WITH d WHERE $author <> ''
                    MERGE (a:Onk:OnkDoctor {name: $author}) MERGE (d)-[:AUTHORED_BY]->(a) }
                """, uuid=patient_uuid, uid=doc_uid, meta=_clean(meta), facility=meta.get("facility") or "",
                  author=meta.get("author") or "")
            for f in facts:
                kind, props = f["kind"], _clean(f["props"])
                src = {"quote": f.get("quote", "")[:2000], "match": f.get("match"), "method": f.get("method", "rule"),
                       "section": f.get("section", "")}
                if kind == "patient":
                    t.run("""MATCH (p:OnkPatient {uuid: $uuid}) MATCH (d:OnkDocument {uid: $uid})
                             SET p += $props MERGE (p)-[r:STATED_IN]->(d) SET r += $src""",
                          uuid=patient_uuid, uid=doc_uid, props={k: v for k, v in props.items() if v is not None}, src=src)
                    continue
                label = LABELS[kind]
                node_id = f"{patient_uuid}:{kind}:{f['key']}" if kind in MERGED_KINDS else f"{doc_uid}:{kind}:{f['key']}"
                t.run(f"""
                    MATCH (p:OnkPatient {{uuid: $uuid}}) MATCH (d:OnkDocument {{uid: $uid}})
                    MERGE (n:Onk:{label} {{id: $id}})
                    ON CREATE SET n += $props, n.kind = $kind, n.patient_uuid = $uuid
                    ON MATCH SET n.icd10 = coalesce(n.icd10, $props.icd10),
                                 n.name = CASE WHEN $props.name IS NULL THEN n.name
                                               WHEN n.name IS NULL THEN $props.name
                                               WHEN $props.icd10 IS NOT NULL AND n.icd10_from_name IS NULL THEN $props.name
                                               WHEN size($props.name) < size(n.name) THEN $props.name ELSE n.name END,
                                 n.icd10_from_name = CASE WHEN $props.icd10 IS NOT NULL THEN true ELSE n.icd10_from_name END
                    MERGE (p)-[:HAS]->(n)
                    MERGE (n)-[r:STATED_IN]->(d) SET r += $src
                    """, uuid=patient_uuid, uid=doc_uid, id=node_id, props=props, kind=kind, src=src)
            for i, fl in enumerate(flags):
                t.run("""MATCH (p:OnkPatient {uuid: $uuid}) MATCH (d:OnkDocument {uid: $uid})
                         MERGE (x:Onk:OnkFlag {id: $id}) SET x += $props
                         MERGE (p)-[:HAS_FLAG]->(x) MERGE (x)-[:RAISED_ON]->(d)""",
                      uuid=patient_uuid, uid=doc_uid, id=f"{doc_uid}:flag:{i}", props=_clean(fl))
            for i, c in enumerate(chunks or []):
                t.run("""MATCH (d:OnkDocument {uid: $uid})
                         MERGE (c:Onk:OnkChunk {id: $id}) SET c.text = $text, c.section = $section, c.i = $i
                         MERGE (c)-[:PART_OF]->(d)""", uid=doc_uid, id=f"{doc_uid}:chunk:{i}", text=c["text"],
                      section=c.get("section", ""), i=i)

        with self.driver.session(database="neo4j") as s:
            s.execute_write(tx)

    def delete_document(self, doc_uid: str) -> None:
        """Remove a document and the facts that only it supported (used when re-extracting)."""
        self.run("""
            MATCH (d:OnkDocument {uid: $uid})
            OPTIONAL MATCH (x:OnkFlag)-[:RAISED_ON]->(d) DETACH DELETE x
            WITH d
            OPTIONAL MATCH (c:OnkChunk)-[:PART_OF]->(d) DETACH DELETE c
            WITH d
            OPTIONAL MATCH (n:Onk)-[r:STATED_IN]->(d) WHERE NOT n:OnkPatient
            DELETE r
            WITH d, collect(DISTINCT n) AS ns
            DETACH DELETE d
            WITH ns UNWIND ns AS n
            WITH n WHERE n IS NOT NULL AND NOT (n)-[:STATED_IN]->()
            DETACH DELETE n""", uid=doc_uid)

    def delete_patient(self, patient_uuid: str) -> None:
        self.run("""MATCH (p:OnkPatient {uuid: $uuid})
                    OPTIONAL MATCH (p)-[:HAS|HAS_FLAG]->(n:Onk)
                    OPTIONAL MATCH (d:OnkDocument)-[:ABOUT]->(p)
                    OPTIONAL MATCH (c:OnkChunk)-[:PART_OF]->(d)
                    DETACH DELETE n, c, d, p""", uuid=patient_uuid)

    def reset(self) -> int:
        """Delete ALL Onkomost nodes (label :Onk) – and nothing else."""
        n = self.run("MATCH (n:Onk) RETURN count(n) AS c")[0]["c"]
        self.run("MATCH (n:Onk) DETACH DELETE n")
        self.run("MATCH (n:Onk) DETACH DELETE n")  # orphans of the first pass, if any
        return n

    def label_counts(self, onk: bool | None = None) -> dict[str, int]:
        where = "" if onk is None else ("WHERE n:Onk" if onk else "WHERE NOT n:Onk")
        rows = self.run(f"MATCH (n) {where} UNWIND labels(n) AS l RETURN l, count(*) AS c")
        return {r["l"]: r["c"] for r in rows}

    # -- reads -----------------------------------------------------------------------------------
    def facts(self, patient_uuid: str, cutoff: date | None = None) -> dict[str, list[dict]]:
        """kind → [{id, props, sources:[…]}], keeping only sources dated on/before `cutoff`."""
        rows = self.run("""
            MATCH (p:OnkPatient {uuid: $uuid})-[:HAS]->(n:Onk)-[r:STATED_IN]->(d:OnkDocument)
            WHERE $cutoff IS NULL OR d.date IS NULL OR d.date <= $cutoff
            RETURN n.kind AS kind, n.id AS id, properties(n) AS props,
                   collect({doc_uid: d.uid, doc_id: d.sqlite_id, doc_date: d.date, title: d.title, type: d.type,
                            facility: d.facility, quote: r.quote, match: r.match, method: r.method}) AS sources
            """, uuid=patient_uuid, cutoff=cutoff)
        out: dict[str, list[dict]] = {}
        for r in rows:
            r["sources"].sort(key=lambda s: (s["doc_date"] is None, s["doc_date"]))
            out.setdefault(r["kind"], []).append({"id": r["id"], "props": r["props"], "sources": r["sources"]})
        return out

    def patient(self, patient_uuid: str) -> dict:
        rows = self.run("MATCH (p:OnkPatient {uuid: $uuid}) RETURN properties(p) AS p", uuid=patient_uuid)
        return rows[0]["p"] if rows else {}

    def documents(self, patient_uuid: str, cutoff: date | None = None) -> list[dict]:
        return self.run("""
            MATCH (d:OnkDocument)-[:ABOUT]->(:OnkPatient {uuid: $uuid})
            WHERE $cutoff IS NULL OR d.date IS NULL OR d.date <= $cutoff
            RETURN properties(d) AS d ORDER BY d.date""", uuid=patient_uuid, cutoff=cutoff)

    def flags(self, patient_uuid: str) -> list[dict]:
        return self.run("""
            MATCH (:OnkPatient {uuid: $uuid})-[:HAS_FLAG]->(x:OnkFlag)-[:RAISED_ON]->(d:OnkDocument)
            RETURN x.id AS id, properties(x) AS flag, d.uid AS doc_uid, d.sqlite_id AS doc_id, d.title AS title,
                   d.date AS doc_date""", uuid=patient_uuid)

    def view(self, patient_uuid: str, cutoff: date | None = None) -> dict[str, Any]:
        """Nodes + edges for the UI graph."""
        rows = self.run("""
            MATCH (p:OnkPatient {uuid: $uuid})
            OPTIONAL MATCH (d:OnkDocument)-[:ABOUT]->(p)
            WHERE $cutoff IS NULL OR d.date IS NULL OR d.date <= $cutoff
            WITH p, collect(d) AS docs
            OPTIONAL MATCH (p)-[:HAS]->(n:Onk)-[r:STATED_IN]->(d2:OnkDocument) WHERE d2 IN docs
            OPTIONAL MATCH (d3:OnkDocument)-[:FROM]->(f:OnkFacility) WHERE d3 IN docs
            RETURN properties(p) AS patient, [d IN docs | properties(d)] AS docs,
                   collect(DISTINCT {node: properties(n), labels: labels(n), doc: d2.uid}) AS facts,
                   collect(DISTINCT {doc: d3.uid, facility: f.name}) AS facilities
            """, uuid=patient_uuid, cutoff=cutoff)
        if not rows:
            return {"nodes": [], "edges": []}
        r = rows[0]
        nodes, edges, seen = [], [], set()

        def node(nid, kind, label, props=None):
            if nid not in seen:
                seen.add(nid)
                nodes.append({"id": nid, "kind": kind, "label": label, "props": props or {}})

        pid = f"patient:{patient_uuid}"
        node(pid, "patient", r["patient"].get("patient_name", "Pacient"), r["patient"])
        for d in r["docs"]:
            node(d["uid"], "document", d.get("title") or d.get("type"), d)
            edges.append({"source": d["uid"], "target": pid, "label": "ABOUT"})
        for f in r["facilities"]:
            if f["facility"] and f["doc"]:
                fid = f"facility:{f['facility']}"
                node(fid, "facility", f["facility"])
                edges.append({"source": f["doc"], "target": fid, "label": "FROM"})
        for f in r["facts"]:
            n = f["node"]
            if not n or not f["doc"]:
                continue
            kind = n.get("kind", "fact")
            label = n.get("name") or n.get("label") or n.get("analyte") or n.get("text", "")[:40] or kind
            if kind == "lab":
                label = f"{n.get('analyte')} {n.get('value')}{' ' + n['flag'] if n.get('flag') else ''}"
            if kind == "measurement":
                label = f"{n.get('measure')} {n.get('value')} {n.get('unit', '')}"
            node(n["id"], kind, label, n)
            edges.append({"source": pid, "target": n["id"], "label": "HAS"})
            edges.append({"source": n["id"], "target": f["doc"], "label": "STATED_IN"})
        return {"nodes": nodes, "edges": edges}


graph = GraphStore()
