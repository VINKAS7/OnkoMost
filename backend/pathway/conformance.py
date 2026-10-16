"""Patient graph vs. pathway → step statuses, document status (green / red / yellow) and findings.

Deterministic: every requirement is a Cypher query against the patient's graph (documents dated on/before the
cut-off). The LLM is not involved.

Step status:      done | available | blocked | skipped
Document status:  have (green) | missing (red) | conflict (yellow) | conditional (depends on an open decision)
                  | skipped – only for steps that need a document as evidence

Findings:
  to_schedule       – a required step has no evidence yet (e.g. book the CT)
  action            – a manual step / decision is due (accept case, confirm handover, choose route…)
  missing_document  – the referral mentions an exam whose report is not in the case → request it
  mismatch          – flags raised during extraction (impossible dates, …) → a human must check
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta

from backend.extract.pipeline import ANTICOAGULANTS
from backend.graph.store import graph
from backend.pathway.model import Node, PathwayGraph


@dataclass
class Ctx:
    patient_uuid: str
    cutoff: date
    created_on: date
    events: dict[str, date] = field(default_factory=dict)  # manual node → done date
    decisions: dict[str, dict] = field(default_factory=dict)  # decision node → {"keys": [...], "on": date}
    reference_date: date | None = None  # for max_age lab checks (MDT date if known)
    reviewed_flags: set[str] = field(default_factory=set)


def _ev(rows: list[dict]) -> list[dict]:
    return [{"doc_id": r.get("doc_id"), "doc_uid": r.get("doc_uid"), "title": r.get("title"), "date": r.get("date"),
             "quote": (r.get("quote") or "")[:300]} for r in rows]


def check_requirement(req: dict, ctx: Ctx) -> tuple[bool, list[dict], dict]:
    p = {"uuid": ctx.patient_uuid, "cutoff": ctx.cutoff}
    kind = req["kind"]
    base = "MATCH (pt:OnkPatient {uuid: $uuid})"
    ret = "RETURN d.sqlite_id AS doc_id, d.uid AS doc_uid, d.title AS title, d.date AS date, r.quote AS quote ORDER BY d.date"
    if kind == "document":
        rows = graph.run(f"""{base} MATCH (d:OnkDocument {{type: $t}})-[r:ABOUT]->(pt) WHERE d.date <= $cutoff
                             RETURN d.sqlite_id AS doc_id, d.uid AS doc_uid, d.title AS title, d.date AS date, '' AS quote
                             ORDER BY d.date""", t=req["doc_type"], **p)
        return bool(rows), _ev(rows), {}
    if kind == "exam":
        types = req["exam_type"] if isinstance(req["exam_type"], list) else [req["exam_type"]]
        rows = graph.run(f"""{base} MATCH (pt)-[:HAS]->(e:OnkExam)-[r:STATED_IN]->(d:OnkDocument)
                             WHERE e.exam_type IN $t AND d.date <= $cutoff {ret}""", t=types, **p)
        return bool(rows), _ev(rows), {}
    if kind == "diagnosis":
        rows = graph.run(f"""{base} MATCH (pt)-[:HAS]->(x:OnkDiagnosis {{status: $s}})-[r:STATED_IN]->(d:OnkDocument)
                             WHERE d.date <= $cutoff {ret}""", s=req.get("status", "confirmed"), **p)
        return bool(rows), _ev(rows), {}
    if kind == "precaution":
        rows = graph.run(f"""{base} MATCH (pt)-[:HAS]->(x:OnkPrecaution {{precaution: $k}})-[r:STATED_IN]->(d:OnkDocument)
                             WHERE d.date <= $cutoff {ret}""", k=req["precaution"], **p)
        return bool(rows), _ev(rows), {}
    if kind == "lab":
        ref = ctx.reference_date or ctx.cutoff
        since = ref - timedelta(days=req.get("max_age_days", 3650))
        rows = graph.run(f"""{base} MATCH (pt)-[:HAS]->(l:OnkLabResult)-[r:STATED_IN]->(d:OnkDocument)
                             WHERE toLower(l.analyte) = toLower($a) AND d.date <= $cutoff AND d.date >= $since
                             RETURN d.sqlite_id AS doc_id, d.uid AS doc_uid, d.title AS title, d.date AS date,
                                    l.analyte + ' ' + l.value + ' ' + coalesce(l.unit, '') AS quote ORDER BY d.date""",
                         a=req["analyte"], since=since, **p)
        return bool(rows), _ev(rows), {}
    if kind == "mentioned_exams_received":
        items = graph.run(f"""{base} MATCH (pt)-[:HAS]->(m:OnkMentionedExam)-[:STATED_IN]->(src:OnkDocument)
                              WHERE src.date <= $cutoff
                              OPTIONAL MATCH (d:OnkDocument)-[:ABOUT]->(pt)
                                WHERE d.date = m.date AND d.uid <> src.uid AND d.date <= $cutoff
                              RETURN m.id AS id, m.label AS label, m.date AS date, m.place AS place, m.detail AS detail,
                                     collect(d.sqlite_id) AS doc_ids, collect(d.title) AS titles ORDER BY m.date""", **p)
        missing = [i for i in items if not i["doc_ids"]]
        received = [{"doc_id": i["doc_ids"][0], "title": i["titles"][0], "date": i["date"], "quote": i["label"]}
                    for i in items if i["doc_ids"]]
        # no referral listing prior exams → nothing to collect
        return not missing, received, {"items": items, "missing": missing}
    raise ValueError(f"unknown requirement {kind}")


def should_skip(node: Node, ctx: Ctx) -> bool:
    for cond in node.skip_if:
        if cond["kind"] == "no_anticoagulant":
            rows = graph.run("""MATCH (:OnkPatient {uuid: $uuid})-[:HAS]->(m:OnkMedication)
                                WHERE any(a IN $names WHERE toLower(m.name) STARTS WITH a) RETURN count(m) AS c""",
                             uuid=ctx.patient_uuid, names=list(ANTICOAGULANTS))
            if rows[0]["c"] == 0:
                return True
    return False


def _gate(nid: str, pg: PathwayGraph, ctx: Ctx) -> tuple[str, date | None]:
    """Edges leaving a decision with a `branch` key gate their target: open | closed | undecided | none."""
    gated = [e for e in pg.edges if e.target == nid and e.branch is not None]
    if not gated:
        return "none", None
    states = []
    for e in gated:
        d = ctx.decisions.get(e.source)
        if not d:
            states.append(("undecided", None))
        elif e.branch in d.get("keys", []):
            states.append(("open", d.get("on")))
        else:
            states.append(("closed", d.get("on")))
    for want in ("open", "undecided"):
        hit = next((s for s in states if s[0] == want), None)
        if hit:
            return hit
    return "closed", None


def _conflicts(flags: list[dict], doc_ids: set) -> list[dict]:
    return [f for f in flags if f["doc_id"] in doc_ids]


def evaluate(pg: PathwayGraph, ctx: Ctx) -> dict:
    preds = pg.predecessors()
    by_id = {n.id: n for n in pg.nodes}
    status: dict[str, dict] = {}
    findings: list[dict] = []
    flags = [{"key": f"flag:{fl['id']}", "doc_id": fl["doc_id"], "title": fl["title"],
              "message": fl["flag"].get("message", ""), "message_en": fl["flag"].get("message_en", ""),
              "quote": fl["flag"].get("quote", ""), "reviewed": f"flag:{fl['id']}" in ctx.reviewed_flags}
             for fl in graph.flags(ctx.patient_uuid)]

    for nid in pg.topo_order():
        node = pg.node(nid)
        st = {"status": "blocked", "done_on": None, "available_on": None, "due_on": None, "evidence": [], "detail": {},
              "doc_status": None, "conflicts": [], "conditional": False}
        gate, gate_on = _gate(nid, pg, ctx)
        pr_ids = preds.get(nid, [])
        pr = [status[x] for x in pr_ids]
        if gate == "closed" or (pr and all(x["status"] == "skipped" for x in pr)):
            st["status"] = "skipped"
        elif gate == "undecided" or (pr and all(x["conditional"] for x in pr)):
            st["conditional"] = True
        if st["status"] != "skipped":
            # 1) done?
            if node.completion == "evidence":
                if should_skip(node, ctx):
                    st["status"] = "skipped"
                else:
                    oks, evidence, detail = [], [], {}
                    for req in node.requires:
                        ok, ev, det = check_requirement(req, ctx)
                        oks.append(ok)
                        evidence += ev
                        detail.update(det)
                    st["evidence"], st["detail"] = evidence, detail
                    if all(oks):
                        st["status"] = "done"
                        dates = [e["date"] for e in evidence if e.get("date")]
                        st["done_on"] = max(dates) if dates else None
            elif node.completion == "manual":
                if nid in ctx.events:
                    st["status"], st["done_on"] = "done", ctx.events[nid]
            elif node.completion == "branch":
                if node.type == "decision":
                    if nid in ctx.decisions:
                        d = ctx.decisions[nid]
                        st["status"], st["done_on"], st["detail"] = "done", d.get("on"), {"keys": d.get("keys", [])}
                elif gate == "open":
                    st["status"], st["done_on"] = "done", gate_on
        # 2) available? (all blocking predecessors done or skipped)
        ready = all(x["status"] in ("done", "skipped") or not by_id[pid].blocking for pid, x in zip(pr_ids, pr))
        if st["status"] in ("blocked", "done") and ready and gate != "undecided":
            done_dates = [x["done_on"] for x in pr if x["done_on"]]
            st["available_on"] = max(done_dates) if done_dates else ctx.created_on
            st["due_on"] = st["available_on"] + timedelta(days=node.sla_days)
            if node.completion == "auto" and st["status"] == "blocked":
                st["status"], st["done_on"] = "done", st["available_on"]
            elif st["status"] == "blocked":
                st["status"] = "available"

        # 3) document status (green / red / yellow) for steps proven by documents
        if node.completion == "evidence":
            doc_ids = {e["doc_id"] for e in st["evidence"]}
            st["conflicts"] = _conflicts(flags, doc_ids)
            if st["status"] == "skipped":
                st["doc_status"] = "skipped"
            elif st["status"] == "done":
                st["doc_status"] = "conflict" if any(not c["reviewed"] for c in st["conflicts"]) else "have"
            elif st["conditional"]:
                st["doc_status"] = "conditional"
            else:
                st["doc_status"] = "missing"
        status[nid] = st

        # 4) findings for available steps
        if st["status"] == "available":
            overdue = st["due_on"] is not None and st["due_on"] < ctx.cutoff
            base = {"node_id": nid, "owner_role": node.owner_role, "due_on": st["due_on"],
                    "priority": "low" if not node.blocking else ("high" if overdue else "normal")}
            covered = st["detail"].get("missing")  # missing reports are listed one by one below instead
            if node.completion == "evidence" and not covered:
                findings.append({**base, "key": f"step:{nid}", "kind": "to_schedule",
                                 "title": f"Zajistit: {node.label}", "title_en": f"Obtain: {node.label_en or node.label}",
                                 "detail": node.description, "detail_en": ""})
            elif node.completion in ("manual", "branch"):
                findings.append({**base, "key": f"step:{nid}", "kind": "decision" if node.type == "decision" else "action",
                                 "action": node.action, "title": node.label, "title_en": node.label_en or node.label,
                                 "detail": node.description, "detail_en": ""})
        # missing documents are known as soon as the referral is in, even before triage
        if node.completion == "evidence" and any(r["kind"] == "mentioned_exams_received" for r in node.requires):
            for m in st["detail"].get("missing", []):
                when = f"{m['date']:%d. %m. %Y}"
                place = m["place"] or "neuvedeno"
                findings.append({
                    "node_id": nid, "key": f"missing_document:{m['date']}", "kind": "missing_document",
                    "title": f"Vyžádat zprávu: {m['label']} ({when})", "title_en": f"Request report: {m['label']} ({when})",
                    "detail": f"Uvedeno v žádosti PL, výsledek není v dokumentaci. Pracoviště: {place}.",
                    "detail_en": f"Listed in the GP's referral but the result is not in the case. From: {place}.",
                    "owner_role": "coordinator", "facility": m["place"], "item": m["label"], "item_date": m["date"],
                    "due_on": (st["available_on"] or ctx.created_on) + timedelta(days=node.sla_days),
                    "priority": "normal"})

    for f in flags:
        findings.append({
            "node_id": next((n for n, s in status.items() if any(e["doc_id"] == f["doc_id"] for e in s["evidence"])), ""),
            "key": f["key"], "kind": "mismatch",
            "title": f"Nesoulad v dokumentu: {f['title']}", "title_en": f"Conflict in document: {f['title']}",
            "detail": f["message"], "detail_en": f["message_en"] or f["message"],
            "owner_role": "coordinator", "priority": "high", "due_on": ctx.cutoff,
            "doc_id": f["doc_id"], "quote": f["quote"]})

    blocking_pre_mdt = [n.id for n in pg.nodes if n.phase in ("intake", "diagnostics") and n.blocking]
    evidence_nodes = [n.id for n in pg.nodes if n.completion == "evidence"]
    counts = {k: sum(1 for n in evidence_nodes if status[n]["doc_status"] == k)
              for k in ("have", "missing", "conflict", "conditional", "skipped")}
    return {
        "nodes": status,
        "findings": findings,
        "pre_mdt_complete": all(status[n]["status"] in ("done", "skipped") for n in blocking_pre_mdt),
        "doc_counts": counts,
    }
