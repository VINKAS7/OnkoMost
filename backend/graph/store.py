"""Patient graph in InterSystems IRIS globals (the IRIS-Global-GraphRAG pattern: a sparse multi-dimensional
array per graph partition, here one partition per patient).

Only the pseudonymous patient_uuid is stored here. Identifying data (name, RČ, birth date, address, phone,
contact persons) and the documents themselves are in the FHIR server – see backend/fhir/records.py.
Everything Onkomost writes is under the global ^OnkGraph and the SQL table Onk.DocChunk; nothing else in the
namespace is read, changed or deleted.

Model (values are JSON; dates are tagged so they come back as `date`)
  ^OnkGraph("P", uuid)                     patient            {uuid, fhir: "Patient/<uuid>"}
  ^OnkGraph("P", uuid, "D", doc_uid)       document  ABOUT→   {uid, type, date, title, facility, author, sqlite_id, …}
  ^OnkGraph("P", uuid, "F", fact_id)       fact      HAS←     {id, kind, patient_uuid, …props,
                                                              src: {doc_uid: {quote, match, method, section}}}  STATED_IN→
  ^OnkGraph("P", uuid, "X", flag_id)       flag  HAS_FLAG←    {id, …props, doc: doc_uid}  RAISED_ON→
  ^OnkGraph("I", "doc", doc_uid)           index: document → patient
  ^OnkGraph("I", "sqlid", sqlite_id)       index: SQLite document id → doc_uid
Contact persons are fact nodes whose props are only {fhir_ref: "RelatedPerson/…"}; reads fill them in from FHIR.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any

from backend.fhir import records
from backend.fhir.client import fhir
from backend.iris import db
from backend.rag import index

G = "OnkGraph"
# Facts of these kinds are merged across documents (one node, many STATED_IN sources).
MERGED_KINDS = {"condition", "medication", "allergy", "symptom", "contact_person", "referring_doctor"}
# Facts of these kinds identify the patient: their content goes to FHIR, the graph keeps a reference.
FHIR_KINDS = {"patient", "contact_person"}


def _enc(o):
    if isinstance(o, datetime):
        return {"$dt": o.isoformat()}
    if isinstance(o, date):
        return {"$d": o.isoformat()}
    raise TypeError(f"not JSON serialisable: {type(o)}")


def _hook(d: dict):
    if len(d) == 1 and "$d" in d:
        return date.fromisoformat(d["$d"])
    if len(d) == 1 and "$dt" in d:
        return datetime.fromisoformat(d["$dt"])
    return d


def _dump(v) -> str:
    return json.dumps(v, default=_enc, ensure_ascii=False)


def _load(s) -> Any:
    return json.loads(s, object_hook=_hook) if s not in (None, "") else None


def _clean(props: dict) -> dict:
    """Primitives / dates / lists of primitives; None means 'not set'."""
    out = {}
    for k, v in props.items():
        if v is None:
            continue
        if isinstance(v, (str, int, float, bool, date)):
            out[k] = v
        elif isinstance(v, list) and all(isinstance(i, (str, int, float, bool)) for i in v):
            out[k] = v
        else:
            out[k] = str(v)
    return out


def _children(n, *subs) -> list[tuple[Any, Any]]:
    return list(n.iterator(G, *subs))


def _before(d: date | None, cutoff: date | None, allow_undated: bool = True) -> bool:
    if cutoff is None:
        return True
    if d is None:
        return allow_undated
    return d <= cutoff


def _date_key(d: date | None):
    return (d is None, d or date.min)


@dataclass
class Snapshot:
    """Everything stored for one patient, read in one pass. Conformance and GraphRAG query it many times."""
    uuid: str
    docs: dict[str, dict] = field(default_factory=dict)     # doc_uid → meta
    facts: dict[str, dict] = field(default_factory=dict)    # fact_id → props (+ "src")
    flags: dict[str, dict] = field(default_factory=dict)    # flag_id → props (+ "doc")

    def edges(self, kind: str | None = None, cutoff: date | None = None, allow_undated: bool = False):
        """(fact props, document meta, STATED_IN props) for every fact → document edge, oldest document first."""
        out = []
        for f in self.facts.values():
            if kind is not None and f.get("kind") != kind:
                continue
            for uid, src in f.get("src", {}).items():
                d = self.docs.get(uid)
                if d is not None and _before(d.get("date"), cutoff, allow_undated):
                    out.append((f, d, src))
        out.sort(key=lambda x: _date_key(x[1].get("date")))
        return out

    def documents(self, cutoff: date | None = None, allow_undated: bool = True) -> list[dict]:
        docs = [d for d in self.docs.values() if _before(d.get("date"), cutoff, allow_undated)]
        return sorted(docs, key=lambda d: _date_key(d.get("date")))


class GraphStore:
    # -- system ------------------------------------------------------------------------------------
    def ping(self) -> str:
        with db.native() as n:
            version = n.classMethodString("%SYSTEM.Version", "GetVersion")
            patients = sum(1 for _ in n.iterator(G, "P"))
        m = re.match(r"(.*?)\s*\(.*?\)\s*(\S+)", version)  # "IRIS for UNIX (Ubuntu …) 2026.1 (Build …) …"
        version = f"{m.group(1)} {m.group(2)}" if m else version
        return f"{version}, {patients} Onkomost patients in ^{G}, {index.count()} chunks"

    def ensure_schema(self) -> None:
        index.ensure_table()

    # -- writes ------------------------------------------------------------------------------------
    def write_document(self, patient_uuid: str, doc_uid: str, meta: dict, facts: list[dict], flags: list[dict],
                       chunks: list[dict] | None = None, text: str = "", original: bytes | None = None,
                       imaging: dict | None = None) -> None:
        """`imaging` (an image series' DICOM meta) goes to FHIR as an ImagingStudy instead of a DocumentReference."""
        meta = {**_clean(meta), "uid": doc_uid, "patient_uuid": patient_uuid}

        # 1) identifying data → FHIR (idempotent, so a failure later can simply be retried)
        ident: dict = {}
        contacts: dict[str, tuple[dict, str]] = {}
        for f in facts:
            if f["kind"] == "patient":
                ident.update(_clean(f["props"]))
            elif f["kind"] == "contact_person":
                contacts[f"{patient_uuid}:contact_person:{f['key']}"] = (_clean(f["props"]), f.get("quote", ""))
        identity = records.upsert_patient(patient_uuid, ident)
        refs = {fid: records.upsert_contact(patient_uuid, fid, p, q) for fid, (p, q) in contacts.items()}
        if imaging:
            records.upsert_imaging_study(patient_uuid, doc_uid, imaging)
        else:
            records.upsert_document(patient_uuid, doc_uid, meta, text, original)

        # 2) the pseudonymous graph → globals, in one transaction
        with db.transaction() as n:
            n.set(_dump({"uuid": patient_uuid, "fhir": f"Patient/{patient_uuid}"}), G, "P", patient_uuid)
            n.set(_dump(meta), G, "P", patient_uuid, "D", doc_uid)
            n.set(patient_uuid, G, "I", "doc", doc_uid)
            if meta.get("sqlite_id") is not None:
                n.set(doc_uid, G, "I", "sqlid", meta["sqlite_id"])
            for f in facts:
                kind = f["kind"]
                if kind == "patient":
                    continue
                props = _clean(f["props"])
                src = _clean({"quote": (f.get("quote") or "")[:2000], "match": f.get("match"),
                              "method": f.get("method", "rule"), "section": f.get("section", "")})
                node_id = (f"{patient_uuid}:{kind}:{f['key']}" if kind in MERGED_KINDS else f"{doc_uid}:{kind}:{f['key']}")
                if kind == "contact_person":
                    props, src["quote"] = {"fhir_ref": refs[node_id]}, ""
                node = _load(n.get(G, "P", patient_uuid, "F", node_id))
                if node is None:
                    node = {**props, "id": node_id, "kind": kind, "patient_uuid": patient_uuid, "src": {}}
                else:
                    self._merge(node, props)
                node["src"][doc_uid] = {**node["src"].get(doc_uid, {}), **src}
                n.set(_dump(node), G, "P", patient_uuid, "F", node_id)
            for i, fl in enumerate(flags):
                fid = f"{doc_uid}:flag:{i}"
                n.set(_dump({**_clean(fl), "id": fid, "doc": doc_uid}), G, "P", patient_uuid, "X", fid)

        # 3) GraphRAG chunks → SQL vector table, with the patient's identifiers masked
        identifiers = [identity.get(k) for k in ("patient_name", "rc", "phone", "address")]
        identifiers += (identity.get("patient_name") or "").split()
        for p, _ in contacts.values():
            identifiers += [p.get("name"), p.get("phone")]
        index.write(patient_uuid, doc_uid, meta, chunks or [], [i for i in identifiers if i])

    @staticmethod
    def _merge(node: dict, props: dict) -> None:
        """A merged fact stated again by another document: keep the ICD-10 code and the best name."""
        new_name, new_icd = props.get("name"), props.get("icd10")
        if node.get("icd10") is None and new_icd is not None:
            node["icd10"] = new_icd
        if new_name is not None:
            if node.get("name") is None:
                node["name"] = new_name
            elif new_icd is not None and node.get("icd10_from_name") is None:
                node["name"] = new_name
            elif len(new_name) < len(node["name"]):
                node["name"] = new_name
        if new_icd is not None:
            node["icd10_from_name"] = True
        if "fhir_ref" in props:
            node["fhir_ref"] = props["fhir_ref"]

    def delete_document(self, doc_uid: str) -> None:
        """Remove a document and the facts that only it supported (used when re-extracting)."""
        orphans: list[str] = []
        with db.transaction() as n:
            uuid = n.get(G, "I", "doc", doc_uid)
            if uuid:
                meta = _load(n.get(G, "P", uuid, "D", doc_uid)) or {}
                n.kill(G, "P", uuid, "D", doc_uid)
                n.kill(G, "I", "doc", doc_uid)
                if meta.get("sqlite_id") is not None:
                    n.kill(G, "I", "sqlid", meta["sqlite_id"])
                for fid, v in _children(n, "P", uuid, "X"):
                    if (_load(v) or {}).get("doc") == doc_uid:
                        n.kill(G, "P", uuid, "X", fid)
                for fid, v in _children(n, "P", uuid, "F"):
                    node = _load(v) or {}
                    if doc_uid not in node.get("src", {}):
                        continue
                    del node["src"][doc_uid]
                    if node["src"]:
                        n.set(_dump(node), G, "P", uuid, "F", fid)
                    else:
                        n.kill(G, "P", uuid, "F", fid)
                        if node.get("fhir_ref"):
                            orphans.append(node["fhir_ref"])
        index.delete_doc(doc_uid)
        records.delete_document(doc_uid)
        for ref in orphans:
            records.delete_contact(ref)

    def delete_patient(self, patient_uuid: str) -> None:
        with db.transaction() as n:
            for uid, _ in _children(n, "P", patient_uuid, "D"):
                meta = _load(n.get(G, "P", patient_uuid, "D", uid)) or {}
                n.kill(G, "I", "doc", uid)
                if meta.get("sqlite_id") is not None:
                    n.kill(G, "I", "sqlid", meta["sqlite_id"])
            n.kill(G, "P", patient_uuid)
        index.delete_patient(patient_uuid)
        records.delete_patient(patient_uuid)

    def reset(self) -> int:
        """Delete ALL Onkomost data – ^OnkGraph, Onk.DocChunk and the tagged FHIR resources – and nothing else."""
        snap_count = 0
        with db.native() as n:
            for uuid, _ in _children(n, "P"):
                snap_count += 1 + sum(1 for _ in n.iterator(G, "P", uuid, "D")) + sum(1 for _ in n.iterator(G, "P", uuid, "F"))
            n.kill(G)
        index.reset()
        fhir.delete_tagged()
        records.forget_cache()
        return snap_count

    def foreign_counts(self) -> dict[str, int]:
        """Data in the FHIR server that Onkomost did not write (tests check it never changes)."""
        return fhir.foreign_counts()

    # -- reads -------------------------------------------------------------------------------------
    def snapshot(self, patient_uuid: str) -> Snapshot:
        snap = Snapshot(patient_uuid)
        with db.native() as n:
            for uid, v in _children(n, "P", patient_uuid, "D"):
                snap.docs[uid] = _load(v)
            for fid, v in _children(n, "P", patient_uuid, "F"):
                snap.facts[fid] = _load(v)
            for xid, v in _children(n, "P", patient_uuid, "X"):
                snap.flags[xid] = _load(v)
        for f in snap.facts.values():
            if f.get("fhir_ref"):
                c = records.contact(f["fhir_ref"])
                f.update({k: v for k, v in c.items() if k != "quote"})
                for src in f.get("src", {}).values():
                    src["quote"] = src.get("quote") or c.get("quote", "")
        return snap

    @staticmethod
    def _props(f: dict) -> dict:
        return {k: v for k, v in f.items() if k != "src"}

    def facts(self, patient_uuid: str, cutoff: date | None = None) -> dict[str, list[dict]]:
        """kind → [{id, props, sources:[…]}], keeping only sources dated on/before `cutoff`."""
        snap = self.snapshot(patient_uuid)
        grouped: dict[str, dict] = {}
        for f, d, src in snap.edges(cutoff=cutoff, allow_undated=True):
            e = grouped.setdefault(f["id"], {"id": f["id"], "props": self._props(f), "sources": []})
            e["sources"].append({"doc_uid": d["uid"], "doc_id": d.get("sqlite_id"), "doc_date": d.get("date"),
                                 "title": d.get("title"), "type": d.get("type"), "facility": d.get("facility"),
                                 "quote": src.get("quote"), "match": src.get("match"), "method": src.get("method")})
        out: dict[str, list[dict]] = {}
        for e in grouped.values():
            out.setdefault(e["props"]["kind"], []).append(e)
        return out

    def patient(self, patient_uuid: str) -> dict:
        """Identity from the FHIR Patient resource ({} when unknown)."""
        return records.identity(patient_uuid)

    def documents(self, patient_uuid: str, cutoff: date | None = None) -> list[dict]:
        return [{"d": d} for d in self.snapshot(patient_uuid).documents(cutoff)]

    def document_by_sqlite_id(self, sqlite_id: int) -> dict | None:
        with db.native() as n:
            uid = n.get(G, "I", "sqlid", sqlite_id)
            uuid = n.get(G, "I", "doc", uid) if uid else None
            return _load(n.get(G, "P", uuid, "D", uid)) if uuid else None

    def flags(self, patient_uuid: str) -> list[dict]:
        snap = self.snapshot(patient_uuid)
        out = []
        for x in snap.flags.values():
            d = snap.docs.get(x.get("doc"))
            if d is None:
                continue
            out.append({"id": x["id"], "flag": {k: v for k, v in x.items() if k != "doc"}, "doc_uid": d["uid"],
                        "doc_id": d.get("sqlite_id"), "title": d.get("title"), "doc_date": d.get("date")})
        return out

    def view(self, patient_uuid: str, cutoff: date | None = None) -> dict[str, Any]:
        """Nodes + edges for the UI graph."""
        identity = records.identity(patient_uuid)
        snap = self.snapshot(patient_uuid)
        if not identity and not snap.docs:
            return {"nodes": [], "edges": []}
        nodes, edges, seen = [], [], set()

        def node(nid, kind, label, props=None):
            if nid not in seen:
                seen.add(nid)
                nodes.append({"id": nid, "kind": kind, "label": label, "props": props or {}})

        pid = f"patient:{patient_uuid}"
        node(pid, "patient", identity.get("patient_name", "Pacient"), identity)
        docs = snap.documents(cutoff)
        for d in docs:
            node(d["uid"], "document", d.get("title") or d.get("type"), d)
            edges.append({"source": d["uid"], "target": pid, "label": "ABOUT"})
        for d in docs:
            if d.get("facility"):
                fid = f"facility:{d['facility']}"
                node(fid, "facility", d["facility"])
                edges.append({"source": d["uid"], "target": fid, "label": "FROM"})
        for f, d, _ in snap.edges(cutoff=cutoff, allow_undated=True):
            n = self._props(f)
            kind = n.get("kind", "fact")
            label = n.get("name") or n.get("label") or n.get("analyte") or n.get("text", "")[:40] or kind
            if kind == "lab":
                label = f"{n.get('analyte')} {n.get('value')}{' ' + n['flag'] if n.get('flag') else ''}"
            if kind == "measurement":
                label = f"{n.get('measure')} {n.get('value')} {n.get('unit', '')}"
            node(n["id"], kind, label, n)
            edges.append({"source": pid, "target": n["id"], "label": "HAS"})
            edges.append({"source": n["id"], "target": d["uid"], "label": "STATED_IN"})
        return {"nodes": nodes, "edges": edges}


graph = GraphStore()
