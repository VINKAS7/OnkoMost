"""Patient graph vs. pathway → step statuses, document status (green / red / yellow) and findings.

Every requirement is a fixed query against the patient's graph in IRIS (documents dated on/before the cut-off). The
graph holds what the rules read and the step matches the LLM made (node_match facts, each with a verified quote);
this module itself calls no LLM.

Step status:      done | available | blocked | skipped
Document status:  have (green) | missing (red) | conflict (yellow) | conditional (depends on an open decision)
                  | skipped (not needed for this patient) | waived (the coordinator went on without it)
                  – only for steps that need a document as evidence

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
from backend.graph.store import Snapshot, graph
from backend.ingest.reader import fold
from backend.pathway.formats import format_ok
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
    waived: dict[str, date] = field(default_factory=dict)  # document step → day the coordinator chose to go without it
    _snap: Snapshot | None = field(default=None, repr=False)

    @property
    def snap(self) -> Snapshot:
        """The patient's graph, read once per evaluation."""
        if self._snap is None:
            self._snap = graph.snapshot(self.patient_uuid)
        return self._snap


def _ev(rows: list[dict]) -> list[dict]:
    return [{"doc_id": r.get("doc_id"), "doc_uid": r.get("doc_uid"), "title": r.get("title"), "date": r.get("date"),
             "quote": (r.get("quote") or "")[:300]} for r in rows]


def _row(d: dict, quote: str | None = "", **extra) -> dict:
    return {"doc_id": d.get("sqlite_id"), "doc_uid": d["uid"], "title": d.get("title"), "date": d.get("date"),
            "quote": quote, **extra}


def _facts(ctx: Ctx, kind: str, keep, quote=None) -> list[dict]:
    """Evidence rows for facts of `kind` that pass `keep`, stated in documents dated on/before the cut-off."""
    return [_row(d, quote(f) if quote else src.get("quote"), filename=d.get("filename"))
            for f, d, src in ctx.snap.edges(kind, ctx.cutoff) if keep(f)]


def check_requirement(req: dict, ctx: Ctx) -> tuple[bool, list[dict], dict]:
    kind = req["kind"]
    if kind == "document":
        rows = [_row(d) for d in ctx.snap.documents(ctx.cutoff, allow_undated=False) if d.get("type") == req["doc_type"]]
        return bool(rows), _ev(rows), {}
    if kind == "exam":
        types = req["exam_type"] if isinstance(req["exam_type"], list) else [req["exam_type"]]
        # an exam only reported inside another document (a CT quoted in a letter) is not the exam's report
        rows = _facts(ctx, "exam", lambda f: f.get("exam_type") in types and not f.get("reported"))
        return bool(rows), _ev(rows), {}
    if kind == "diagnosis":
        rows = _facts(ctx, "diagnosis", lambda f: f.get("status") == req.get("status", "confirmed"))
        return bool(rows), _ev(rows), {}
    if kind == "precaution":
        rows = _facts(ctx, "precaution", lambda f: f.get("precaution") == req["precaution"])
        return bool(rows), _ev(rows), {}
    if kind == "lab":
        ref = ctx.reference_date or ctx.cutoff
        since = ref - timedelta(days=req.get("max_age_days", 3650))
        analyte = req["analyte"].lower()
        rows = [r for r in _facts(ctx, "lab", lambda f: str(f.get("analyte", "")).lower() == analyte,
                                  quote=lambda f: f"{f.get('analyte')} {f.get('value')} {f.get('unit') or ''}")
                if r["date"] >= since]
        return bool(rows), _ev(rows), {}
    if kind == "mentioned_exams_received":
        docs = ctx.snap.documents(ctx.cutoff, allow_undated=False)
        items: dict[str, dict] = {}
        for m, src, _ in ctx.snap.edges("mentioned_exam", ctx.cutoff):
            it = items.setdefault(m["id"], {"id": m["id"], "label": m.get("label"), "date": m.get("date"),
                                            "place": m.get("place"), "detail": m.get("detail"), "doc_ids": [], "titles": []})
            for d in docs:
                if d.get("date") == m.get("date") and d["uid"] != src["uid"]:
                    it["doc_ids"].append(d.get("sqlite_id"))
                    it["titles"].append(d.get("title"))
        items_l = sorted(items.values(), key=lambda i: (i["date"] is None, i["date"] or date.min))
        missing = [i for i in items_l if not i["doc_ids"]]
        received = [{"doc_id": i["doc_ids"][0], "title": i["titles"][0], "date": i["date"], "quote": i["label"]}
                    for i in items_l if i["doc_ids"]]
        # no referral listing prior exams → nothing to collect
        return not missing, received, {"items": items_l, "missing": missing}
    if kind == "described":
        nid = req.get("node_id") or ""
        rows = _facts(ctx, "node_match", lambda f: f.get("node_id") == nid)
        accepted = req.get("accepted_formats") or []
        kept = [r for r in rows if format_ok(accepted, r.get("filename") or "")]
        return bool(kept), _ev(kept), {}
    raise ValueError(f"unknown requirement {kind}")


def should_skip(node: Node, ctx: Ctx) -> bool:
    for cond in node.skip_if:
        if cond["kind"] == "diagnosis_text":
            # e.g. biomarkers for NSCLC are not needed in small-cell carcinoma: skip when a confirmed diagnosis names
            # one of `any` and none of `none` ("nemalobuněčný" contains "malobuněčn", so it goes in `none`)
            names = [fold(str(f.get("name", ""))) for f, _, _ in ctx.snap.edges("diagnosis", ctx.cutoff)
                     if f.get("status") == "confirmed"]
            if any(any(fold(a) in n for a in cond.get("any", [])) and not any(fold(x) in n for x in cond.get("none", []))
                   for n in names):
                return True
        if cond["kind"] == "no_anticoagulant":
            names = [a.lower() for a in ANTICOAGULANTS]
            meds = [f for f in ctx.snap.facts.values() if f.get("kind") == "medication"
                    and any(str(f.get("name", "")).lower().startswith(a) for a in names)]
            if not meds:
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


def _flags(ctx: Ctx) -> list[dict]:
    out = []
    for x in ctx.snap.flags.values():
        d = ctx.snap.docs.get(x.get("doc"))
        if d is not None:
            out.append({"id": x["id"], "flag": x, "doc_id": d.get("sqlite_id"), "title": d.get("title")})
    return out


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
             for fl in _flags(ctx)]

    for nid in pg.topo_order():
        node = pg.node(nid)
        st = {"status": "blocked", "done_on": None, "available_on": None, "due_on": None, "evidence": [], "detail": {},
              "doc_status": None, "conflicts": [], "conditional": False, "branch_closed": False, "waived": False}
        gate, gate_on = _gate(nid, pg, ctx)
        pr_ids = preds.get(nid, [])
        pr = [status[x] for x in pr_ids]
        # Only a branch the decision did not choose closes what follows it. A step skipped because this patient does
        # not need it (no anticoagulant to stop) counts as done for the steps after it (see "ready" below).
        if gate == "closed" or (pr and all(x["branch_closed"] for x in pr)):
            st["status"], st["branch_closed"] = "skipped", True
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
                        payload = dict(req)
                        if payload.get("kind") == "described":
                            payload.setdefault("node_id", nid)
                            payload.setdefault("accepted_formats", node.accepted_formats)
                        ok, ev, det = check_requirement(payload, ctx)
                        oks.append(ok)
                        evidence += ev
                        detail.update(det)
                    if not all(oks) and (node.description or node.accepted_formats):
                        ok, ev, _ = check_requirement(
                            {"kind": "described", "node_id": nid, "accepted_formats": node.accepted_formats}, ctx)
                        if ok:
                            oks, evidence = [True] * max(1, len(oks)), ev
                    st["evidence"], st["detail"] = evidence, detail
                    if all(oks):
                        st["status"] = "done"
                        dates = [e["date"] for e in evidence if e.get("date")]
                        st["done_on"] = max(dates) if dates else None
                    elif nid in ctx.waived:
                        # the coordinator goes on without this document: it counts as done for the steps after it,
                        # but stays visible as "waived" (never as "have")
                        st["status"], st["done_on"], st["waived"] = "skipped", ctx.waived[nid], True
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
                st["doc_status"] = "waived" if st["waived"] else "skipped"
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
              for k in ("have", "missing", "conflict", "conditional", "skipped", "waived")}
    return {
        "nodes": status,
        "findings": findings,
        "pre_mdt_complete": all(status[n]["status"] in ("done", "skipped") for n in blocking_pre_mdt),
        "doc_counts": counts,
    }
