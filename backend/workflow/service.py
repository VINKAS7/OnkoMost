"""Case workflow: referral → ingestion → conformance → tasks → MDT → feedback → closed.

All state changes go through here and are written to the audit log.
"""
from __future__ import annotations

import hashlib
import json
import logging
import queue
import re
import secrets
import shutil
import threading
from datetime import date, timedelta
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.config import ROOT, settings
from backend.extract.pipeline import extract_document
from backend.fhir import records
from backend.graph.store import graph
from backend.ingest.classify import classify
from backend.ingest.identity import check_identity, patient_uuid, rc_info
from backend.ingest.reader import fold, read_document
from backend.pathway.conformance import Ctx, evaluate
from backend.pathway.model import ROLES, validate
from backend.reports import feedback as fb
from backend.reports import handover as hv
from backend.reports import mdt as mdtr
from backend.rag import ask as rag
from backend.workflow.db import (AuditLog, Case, CaseMessage, DocRequest, Document, FlagReview, HandoverEntry, Koc, OutboxMessage,
                                 Pathway, PathwayVersion, StepEvent, Task, audit, session_scope, today)

log = logging.getLogger(__name__)

STATES = [
    ("sent", "Odesláno", "Sent"),
    ("in_triage", "V triage", "In triage"),
    ("waiting_for_documents", "Čeká na podklady", "Waiting for documents"),
    ("complete", "Kompletní", "Complete"),
    ("ready_for_mdt", "Připraveno k rozhodnutí / MDT", "Ready for decision / MDT"),
    ("mdt_conclusion", "Závěr KOC / MDT", "KOC / MDT conclusion"),
    ("feedback_sent", "Zpětná vazba odeslána", "Feedback sent"),
    ("closed", "Uzavřeno", "Closed"),
]
STATE_KEYS = [s[0] for s in STATES]


class WorkflowError(ValueError):
    pass


# --- storage ----------------------------------------------------------------------------------

def store_raw(p_uuid: str, filename: str, data: bytes) -> tuple[str, Path]:
    sha = hashlib.sha256(data).hexdigest()
    folder = settings.raw_dir / p_uuid
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{sha}{Path(filename).suffix.lower()}"
    if not path.exists():  # immutable: never overwrite an original
        path.write_bytes(data)
    return sha, path


def _rel(path: Path) -> str:
    try:
        return path.relative_to(ROOT).as_posix()
    except ValueError:
        return str(path)


def _abs(rel: str) -> Path:
    p = Path(rel)
    return p if p.is_absolute() else ROOT / p


# --- ingestion worker ---------------------------------------------------------------------------

_queue: "queue.Queue[int]" = queue.Queue()
_worker: threading.Thread | None = None


def start_worker() -> None:
    global _worker
    if _worker and _worker.is_alive():
        return
    with session_scope() as s:
        for d in s.scalars(select(Document).where(Document.status.in_(["queued", "processing"]))):
            _queue.put(d.id)
    _worker = threading.Thread(target=_work, daemon=True, name="ingest")
    _worker.start()


def _work() -> None:
    while True:
        doc_id = _queue.get()
        try:
            process_document(doc_id)
        except Exception:  # noqa: BLE001
            log.exception("processing document %s failed", doc_id)
        finally:
            _queue.task_done()


def enqueue(doc_id: int, sync: bool = False) -> None:
    if sync:
        process_document(doc_id)
    else:
        _queue.put(doc_id)


def queue_size() -> int:
    return _queue.qsize()


# --- referral & documents --------------------------------------------------------------------------

def _pathway_for(s: Session, icd: str) -> PathwayVersion:
    for pw in s.scalars(select(Pathway)):
        if any(icd.startswith(c) for c in pw.icd_codes):
            v = next((v for v in pw.versions if v.status == "active"), None)
            if v:
                return v
    v = s.scalars(select(PathwayVersion).where(PathwayVersion.status == "active")).first()
    if not v:
        raise WorkflowError("No active pathway – run the seed first")
    return v


def create_referral(koc_id: int, files: list[tuple[str, bytes]], actor: str = "Referující lékař",
                    sync: bool = False, pathway_id: int | None = None, patient_name: str = "", rc: str = "",
                    referrer: dict | None = None) -> int:
    """GP refers a patient: patient name + RČ + detected cancer type + the documents they already have.
    Every uploaded document is later checked against that identity. Anything the GP leaves empty is read from
    the referral letter."""
    if not files:
        raise WorkflowError("Nahrajte alespoň jeden dokument / Upload at least one document.")
    rc = re.sub(r"\s", "", rc or "")
    if rc and not re.fullmatch(r"\d{6}/?\d{3,4}", rc):
        raise WorkflowError("Rodné číslo musí mít tvar 123456/7890 / Birth number must look like 123456/7890.")
    if rc and "/" not in rc:
        rc = f"{rc[:6]}/{rc[6:]}"
    tmp = settings.raw_dir / "_incoming"
    tmp.mkdir(parents=True, exist_ok=True)
    parsed = []
    for name, data in files:
        tp = tmp / f"{hashlib.sha256(data).hexdigest()}{Path(name).suffix.lower()}"
        tp.write_bytes(data)
        try:
            doc = read_document(tp)
            parsed.append((name, data, doc, classify(doc)[0]))
        except Exception as e:  # noqa: BLE001
            raise WorkflowError(f"Soubor {name} nelze přečíst: {e}") from e
        finally:
            tp.unlink(missing_ok=True)
    referral = next((p for p in parsed if p[3] == "referral"), None) or next((p for p in parsed if p[2].header.get("rc")), None)
    h = referral[2].header if referral else {}
    rc = rc or h.get("rc", "")
    if not rc:
        raise WorkflowError("Zadejte rodné číslo pacienta / Enter the patient's birth number (RČ).")
    patient_name = (patient_name or h.get("patient_name", "")).strip()
    if not patient_name:
        raise WorkflowError("Zadejte jméno pacienta / Enter the patient's name.")
    p_uuid = patient_uuid(rc)
    suspected = ""
    m = re.search(r"Suspektní diagnóza:\s*([A-Z]\d{2}(?:\.\d)?)", referral[2].full_text) if referral else None
    if m:
        suspected = m.group(1)

    with session_scope() as s:
        koc = s.get(Koc, koc_id)
        if not koc:
            raise WorkflowError("Neznámé KOC")
        if pathway_id:
            pw = s.get(Pathway, pathway_id)
            version = next((v for v in pw.versions if v.status == "active"), None) if pw else None
            if not version:
                raise WorkflowError("Pro tento typ nádoru není aktivní cesta / No active pathway for this cancer type.")
            suspected = suspected or (pw.icd_codes[0] if pw.icd_codes else "")
        else:
            version = _pathway_for(s, suspected or "C")
        lines = h.get("facility_lines", [])
        letter_doctor = {"name": next((l for l in lines if l.startswith("MUDr.")), h.get("author", "")).split(",")[0],
                         "practice": lines[0] if lines else "",
                         "address": next((l for l in lines if re.search(r"\d{3}\s?\d{2}", l) and not l.startswith("IČP")), ""),
                         "phone": h.get("facility_phone")}
        rd = {**letter_doctor, **{k: v for k, v in (referrer or {}).items() if v}}
        # identity goes to the FHIR server; the case keeps only the pseudonymous uuid
        info = rc_info(rc)
        records.upsert_patient(p_uuid, {"patient_name": patient_name, "rc": rc, "dob": info.get("dob") or h.get("dob"),
                                        "sex": info.get("sex")})
        case = Case(patient_uuid=p_uuid, koc_id=koc.id, pathway_version_id=version.id,
                    referring_doctor=rd, suspected_diagnosis=suspected, decisions={},
                    created_on=h.get("doc_date") or today(s))
        s.add(case)
        s.flush()
        audit(s, "case.created", actor, case.id, koc=koc.code, pathway_version=version.version, files=[p[0] for p in parsed])
        doc_ids = [_add_document(s, case, name, data, "referral" if p is referral else "upload")
                   for p in parsed for name, data in [(p[0], p[1])]]
        case_id = case.id
    for d in doc_ids:
        enqueue(d, sync)
    return case_id


def _add_document(s: Session, case: Case, filename: str, data: bytes, source: str) -> int:
    sha, path = store_raw(case.patient_uuid, filename, data)
    existing = s.scalars(select(Document).where(Document.case_id == case.id, Document.sha256 == sha)).first()
    if existing:
        return existing.id
    d = Document(case_id=case.id, sha256=sha, filename=filename, path=_rel(path), source=source, uploaded_on=today(s))
    s.add(d)
    s.flush()
    audit(s, "document.uploaded", "coordinator" if source != "referral" else "referring doctor", case.id,
          filename=filename, sha256=sha)
    return d.id


def add_document(case_id: int, filename: str, data: bytes, source: str = "upload", actor: str = "koordinátor",
                 sync: bool = False) -> int:
    with session_scope() as s:
        case = s.get(Case, case_id)
        if not case:
            raise WorkflowError("Neznámý případ")
        doc_id = _add_document(s, case, filename, data, source)
        if source == "gp":  # the referring doctor answered with a document
            open_q = list(s.scalars(select(CaseMessage).where(CaseMessage.case_id == case_id, CaseMessage.to_role == "gp",
                                                            CaseMessage.resolved.is_(False))))
            for q in open_q:
                q.resolved = True
            s.add(CaseMessage(case_id=case_id, author_role="gp", author=actor, to_role="coordinator",
                              body=f"Nahrán dokument / document uploaded: {filename}",
                              reply_to=open_q[-1].id if open_q else None, resolved=True, on=today(s)))
            audit(s, "message.gp_upload", actor, case_id, filename=filename)
    enqueue(doc_id, sync)
    return doc_id


def process_document(doc_id: int) -> None:
    with session_scope() as s:
        d = s.get(Document, doc_id)
        case = s.get(Case, d.case_id)
        d.status, d.error = "processing", ""
        path, p_uuid = _abs(d.path), case.patient_uuid
        ident = case.identity
        case_rc, case_name, case_dob = ident.get("rc", ""), ident.get("patient_name", ""), ident.get("dob")
    try:
        doc = read_document(path)
        ident = check_identity(doc.header, case_rc, case_name, case_dob)
        x = extract_document(doc) if ident["ok"] else None
    except Exception as e:  # noqa: BLE001
        with session_scope() as s:
            d = s.get(Document, doc_id)
            d.status, d.error = "error", str(e)
            audit(s, "document.error", "system", d.case_id, doc_id=doc_id, error=str(e))
        raise
    with session_scope() as s:
        d = s.get(Document, doc_id)
        d.identity = ident
        if not ident["ok"]:
            d.status = "blocked"
            d.doc_type, _ = classify(doc)
            d.title, d.doc_date = doc.title, doc.header.get("doc_date")
            audit(s, "document.blocked", "system", d.case_id, doc_id=doc_id, issues=ident["issues"])
        else:
            d.doc_type, d.title, d.doc_date = x.doc_type, x.title, x.doc_date
            d.facility, d.author, d.summary = x.facility, x.author, x.summary()
            if x.doc_type != "mdt_conclusion":
                from backend.extract.match_nodes import match_document
                case = s.get(Case, d.case_id)
                try:
                    extras = match_document(
                        (case.pathway_version.graph_json or {}).get("nodes") or [],
                        doc_type=x.doc_type, exam_type=x.exam_type, filename=d.filename,
                        title=x.title, excerpt=doc.full_text)
                except Exception:  # noqa: BLE001
                    extras = []
                x.facts.extend(extras)
                x.llm_calls += sum(1 for f in extras if f.method == "llm")
                doc_uid = f"{p_uuid}:{d.sha256}"
                graph.delete_document(doc_uid)
                graph.write_document(p_uuid, doc_uid, {
                    "type": x.doc_type, "exam_type": x.exam_type, "title": x.title, "date": x.doc_date,
                    "facility": x.facility, "author": x.author, "filename": d.filename, "sqlite_id": d.id,
                    "sha256": d.sha256}, [f.__dict__ for f in x.facts], x.flags, rag.chunks(doc),
                    text=doc.full_text, original=path.read_bytes())
            d.status = "done"
            # A requested report arrived?
            for r in s.scalars(select(DocRequest).where(DocRequest.case_id == d.case_id, DocRequest.status == "requested")):
                if r.item_date and r.item_date == x.doc_date:
                    r.status, r.received_on, r.document_id = "received", today(s), d.id
                    audit(s, "doc_request.received", "system", d.case_id, item=r.item, doc_id=d.id)
            audit(s, "document.extracted", "LLM + pravidla", d.case_id, doc_id=doc_id, doc_type=x.doc_type,
                  **x.summary())
        case_id = d.case_id
    refresh(case_id)


def reprocess(doc_id: int) -> None:
    with session_scope() as s:
        s.get(Document, doc_id).status = "queued"
    enqueue(doc_id)


# --- conformance → tasks → state ---------------------------------------------------------------------

def _owner_name(case: Case, koc: Koc, role: str, facility: str = "") -> str:
    if role == "coordinator":
        return koc.coordinator_name
    if role == "gp":
        return (case.referring_doctor or {}).get("name", "Referující lékař")
    if role == "external":
        return facility or "Externí pracoviště"
    return (koc.staff or {}).get(role) or ROLES.get(role, role)


def _ctx(s: Session, case: Case) -> Ctx:
    events = {e.node_id: e.on for e in s.scalars(select(StepEvent).where(StepEvent.case_id == case.id))}
    decisions = {k: {**v, "on": date.fromisoformat(v["on"]) if v.get("on") else None}
                 for k, v in (case.decisions or {}).items()}
    reviewed = {r.flag_key for r in s.scalars(select(FlagReview).where(FlagReview.case_id == case.id))}
    return Ctx(patient_uuid=case.patient_uuid, cutoff=today(s), created_on=case.created_on, events=events,
               decisions=decisions, reference_date=case.mdt_date, reviewed_flags=reviewed)


def _entries(s: Session, case_id: int) -> list[dict]:
    return [{"field_key": e.field_key, "kind": e.kind, "value": e.value, "by": e.by, "on": e.on}
            for e in s.scalars(select(HandoverEntry).where(HandoverEntry.case_id == case_id).order_by(HandoverEntry.id))]


def refresh(case_id: int) -> dict:
    """Re-run conformance, sync tasks, return the evaluation."""
    with session_scope() as s:
        case = s.get(Case, case_id)
        koc = case.koc
        pg = validate(case.pathway_version.graph_json)
        ctx = _ctx(s, case)
        result = evaluate(pg, ctx)
        findings = result["findings"]
        docs = list(s.scalars(select(Document).where(Document.case_id == case_id)))
        for d in docs:
            if d.status == "blocked":
                findings.append({"key": f"identity:{d.id}", "kind": "mismatch", "node_id": "", "priority": "high",
                                 "title": f"Dokument nepatří pacientovi? {d.filename}",
                                 "title_en": f"Document of another patient? {d.filename}",
                                 "detail": "; ".join(d.identity.get("issues", [])), "owner_role": "coordinator",
                                 "due_on": ctx.cutoff, "doc_id": d.id})
        if "triage" in ctx.events:
            h = hv.build(case.patient_uuid, case.mdt_date or ctx.cutoff, _entries(s, case_id), case.referring_doctor)
            for m in h["missing"]:
                findings.append({"key": f"missing_field:{m['key']}", "kind": "missing_field", "node_id": "handover",
                                 "title": f"Doplnit do handoveru: {m['label']}", "detail": m["note"] or "Údaj chybí v dokumentaci.",
                                 "title_en": f"Add to handover: {m['label_en']}",
                                 "detail_en": m.get("note_en") or "Not found in the documents.",
                                 "owner_role": "coordinator", "priority": "normal" if m["required"] else "low",
                                 "due_on": (case.mdt_date - timedelta(days=1)) if case.mdt_date else ctx.cutoff + timedelta(days=3)})
        reviewed = ctx.reviewed_flags
        requests = {r.key: r for r in s.scalars(select(DocRequest).where(DocRequest.case_id == case_id))}
        tasks = {t.key: t for t in s.scalars(select(Task).where(Task.case_id == case_id))}
        live = set()
        for m in s.scalars(select(CaseMessage).where(CaseMessage.case_id == case_id, CaseMessage.resolved.is_(False))):
            # title = what is asked, not the greeting ("Dobrý den, …")
            lines = [l.strip(" -–") for l in m.body.splitlines() if l.strip() and not re.match(
                r"^(dobrý den|vážen|hello|dear|děkuj|s pozdravem)", l.strip(), re.I)]
            short = ("; ".join(l for l in lines if len(l) < 60)[:70] or " ".join(lines)[:70])
            if m.to_role == "gp":  # coordinator asked the referring doctor -> waiting for them
                findings.append({"key": f"msg:{m.id}", "kind": "question", "node_id": "", "priority": "normal",
                                 "title": f"Čeká na odpověď PL: {short}", "title_en": f"Waiting for the referring doctor: {short}",
                                 "detail": m.body, "owner_role": "gp", "external": True,
                                 "owner_name": (case.referring_doctor or {}).get("name", "Referující lékař"),
                                 "due_on": m.on + timedelta(days=3)})
            elif m.to_role == "coordinator":  # review doctor (or GP) asked the KOC -> coordinator must answer
                who = "revizního lékaře" if m.author_role == "review" else "referujícího lékaře"
                who_en = "review doctor" if m.author_role == "review" else "referring doctor"
                findings.append({"key": f"msg:{m.id}", "kind": "question", "node_id": "", "priority": "high",
                                 "title": f"Dotaz {who}: {short}", "title_en": f"Question from the {who_en}: {short}",
                                 "detail": m.body, "owner_role": "coordinator", "due_on": m.on + timedelta(days=1)})
        if case.closed_on:  # after closure only unresolved data problems stay open; the rest went to K2
            findings = [f for f in findings if f["kind"] in ("mismatch", "question")]
        for f in findings:
            if f["kind"] == "mismatch" and f["key"] in reviewed:
                continue
            live.add(f["key"])
            t = tasks.get(f["key"])
            external, owner = f.get("external", False), f.get("owner_name") or _owner_name(case, koc, f["owner_role"])
            title, title_en = f["title"], f.get("title_en") or f["title"]
            if f["kind"] == "missing_document" and f["key"] in requests:
                external, owner = True, f.get("facility") or "Externí pracoviště"
                title = f"Čeká na zprávu: {f['item']} ({f['item_date']:%d. %m. %Y})"
                title_en = f"Waiting for report: {f['item']} ({f['item_date']:%d. %m. %Y})"
            if t is None:
                t = Task(case_id=case_id, key=f["key"], created_on=ctx.cutoff, kind=f["kind"], title=title)
                s.add(t)
                tasks[f["key"]] = t
            elif t.status in ("done", "dismissed"):
                if t.status == "dismissed":
                    continue
                t.status, t.closed_on, t.resolution = "open", None, ""
            t.kind, t.title, t.detail = f["kind"], title, f.get("detail") or ""
            t.title_en, t.detail_en = title_en, f.get("detail_en") or f.get("detail") or ""
            t.node_id, t.owner_role, t.owner_name, t.external = f.get("node_id", ""), f["owner_role"], owner, external
            t.priority, t.due_on = f.get("priority", "normal"), f.get("due_on")
        for key, t in tasks.items():
            if key not in live and t.status in ("open", "scheduled"):
                t.status, t.closed_on = "done", ctx.cutoff
                t.resolution = ("Předáno koordinátorovi léčby (K2)" if case.closed_on else
                                "Vyřešeno – doloženo v dokumentaci" if t.kind != "mismatch" else "Zkontrolováno")
        # auto-close the K1 case
        if result["nodes"].get("closed", {}).get("status") == "done" and not case.closed_on:
            case.closed_on = ctx.cutoff
            audit(s, "case.closed", "system", case_id)
        return result


def state_of(s: Session, case: Case, result: dict) -> str:
    n = result["nodes"]
    done = lambda k: n.get(k, {}).get("status") == "done"  # noqa: E731
    if case.closed_on or done("closed"):
        return "closed"
    if s.scalars(select(OutboxMessage).where(OutboxMessage.case_id == case.id, OutboxMessage.kind == "feedback_gp")).first():
        return "feedback_sent"
    if done("mdt"):
        return "mdt_conclusion"
    if result["pre_mdt_complete"] and done("handover"):
        return "ready_for_mdt"
    if result["pre_mdt_complete"]:
        return "complete"
    if done("triage"):
        return "waiting_for_documents"
    processing = s.scalars(select(Document).where(Document.case_id == case.id,
                                                  Document.status.in_(["queued", "processing"]))).first()
    return "sent" if processing else "in_triage"


# --- views --------------------------------------------------------------------------------------

def _task_dict(t: Task, cutoff: date) -> dict:
    return {"id": t.id, "key": t.key, "kind": t.kind, "title": t.title, "detail": t.detail, "node_id": t.node_id,
            "title_en": t.title_en or t.title, "detail_en": t.detail_en or t.detail,
            "owner_role": t.owner_role, "owner_role_label": ROLES.get(t.owner_role, t.owner_role),
            "owner_name": t.owner_name, "external": t.external, "priority": t.priority, "due_on": t.due_on,
            "overdue": bool(t.due_on and t.status in ("open", "scheduled") and t.due_on < cutoff),
            "status": t.status, "scheduled_on": t.scheduled_on, "scheduled_place": t.scheduled_place,
            "created_on": t.created_on, "closed_on": t.closed_on, "resolution": t.resolution}


PRIO = {"high": 0, "normal": 1, "low": 2}


def case_summary(s: Session, case: Case, result: dict | None = None) -> dict:
    result = result or evaluate(validate(case.pathway_version.graph_json), _ctx(s, case))
    cutoff = today(s)
    state = state_of(s, case, result)
    open_tasks = [t for t in s.scalars(select(Task).where(Task.case_id == case.id)) if t.status in ("open", "scheduled")]
    open_tasks.sort(key=lambda t: (t.external, t.status == "scheduled", PRIO.get(t.priority, 1), t.due_on or date.max))
    nxt = open_tasks[0] if open_tasks else None
    actionable = [t for t in open_tasks if not t.external and t.status == "open"]
    if state in ("sent", "in_triage"):
        queue_ = "new"
    elif state == "closed":
        queue_ = "closed"
    elif not actionable:
        queue_ = "on_hold"
    else:
        queue_ = "active"
    return {
        "id": case.id, "patient_uuid": case.patient_uuid, "patient_name": case.patient_name, "rc": case.rc,
        "dob": case.dob, "koc": {"id": case.koc.id, "code": case.koc.code, "name": case.koc.name},
        "pathway": {"id": case.pathway_version.pathway.id, "name": case.pathway_version.pathway.name,
                    "name_en": case.pathway_version.pathway.name_en, "code": case.pathway_version.pathway.code,
                    "version": case.pathway_version.version, "version_id": case.pathway_version_id},
        "suspected_diagnosis": case.suspected_diagnosis, "referring_doctor": case.referring_doctor,
        "created_on": case.created_on, "accepted_on": case.accepted_on, "mdt_date": case.mdt_date,
        "decisions": case.decisions or {}, "treatments": treatments_of(case), "closed_on": case.closed_on,
        "doc_counts": result.get("doc_counts", {}),
        "state": state, "state_index": STATE_KEYS.index(state), "queue": queue_,
        "next_task": _task_dict(nxt, cutoff) if nxt else None,
        "open_tasks": len(open_tasks), "overdue_tasks": sum(1 for t in open_tasks if t.due_on and t.due_on < cutoff),
        "days_since_referral": (cutoff - case.created_on).days,
    }


def case_detail(case_id: int) -> dict:
    result = refresh(case_id)
    with session_scope() as s:
        case = s.get(Case, case_id)
        cutoff = today(s)
        summary = case_summary(s, case, result)
        pg = case.pathway_version.graph_json
        nodes = []
        for n in pg["nodes"]:
            st = result["nodes"][n["id"]]
            nodes.append({**n, **{k: st[k] for k in ("status", "done_on", "available_on", "due_on", "evidence",
                                                     "doc_status", "conflicts", "conditional")},
                          "detail": {k: v for k, v in st["detail"].items() if k in ("items", "missing", "keys")},
                          "owner_name": _owner_name(case, case.koc, n.get("owner_role", "coordinator"))})
        tasks = sorted((_task_dict(t, cutoff) for t in s.scalars(select(Task).where(Task.case_id == case_id))),
                       key=lambda t: (t["status"] not in ("open", "scheduled"), t["external"], PRIO.get(t["priority"], 1),
                                      t["due_on"] or date.max))
        docs = [{"id": d.id, "filename": d.filename, "source": d.source, "status": d.status, "error": d.error,
                 "doc_type": d.doc_type, "title": d.title, "doc_date": d.doc_date, "facility": d.facility,
                 "author": d.author, "identity": d.identity, "summary": d.summary, "uploaded_on": d.uploaded_on,
                 "post_mdt": bool(case.mdt_date and d.doc_date and d.doc_date > case.mdt_date)}
                for d in s.scalars(select(Document).where(Document.case_id == case_id).order_by(Document.doc_date))]
        requests = [{"id": r.id, "key": r.key, "facility": r.facility, "item": r.item, "item_date": r.item_date,
                     "status": r.status, "requested_on": r.requested_on, "received_on": r.received_on,
                     "message_id": r.message_id}
                    for r in s.scalars(select(DocRequest).where(DocRequest.case_id == case_id))]
        reviews = {r.flag_key: {"note": r.note, "by": r.by, "on": r.on}
                   for r in s.scalars(select(FlagReview).where(FlagReview.case_id == case_id))}
        findings = [{**f, "reviewed": reviews.get(f["key"])} for f in result["findings"]]
        messages = [_msg(m) for m in s.scalars(select(OutboxMessage).where(OutboxMessage.case_id == case_id))]
        events = [{"node_id": e.node_id, "on": e.on, "by": e.by, "data": e.data}
                  for e in s.scalars(select(StepEvent).where(StepEvent.case_id == case_id))]
        return {**summary, "states": [{"key": k, "label": cs, "label_en": en} for k, cs, en in STATES],
                "pathway_graph": {"nodes": nodes, "edges": pg["edges"]}, "tasks": tasks, "documents": docs,
                "doc_requests": requests, "findings": findings, "messages": messages, "events": events,
                "mdt_conclusion": case.mdt_conclusion, "mdt_report_ready": bool(case.mdt_report_path),
                "pre_mdt_complete": result["pre_mdt_complete"], "today": cutoff}


def _msg(m: OutboxMessage) -> dict:
    return {"id": m.id, "case_id": m.case_id, "kind": m.kind, "to_name": m.to_name, "to_role": m.to_role,
            "to_address": m.to_address, "subject": m.subject, "body": m.body, "attachments": m.attachments,
            "sent_on": m.sent_on, "ack_token": m.ack_token, "acked_on": m.acked_on, "acked_by": m.acked_by}


def list_cases(koc_id: int | None = None, referrer: str | None = None, mdt_only: bool = False) -> list[dict]:
    with session_scope() as s:
        q = select(Case).order_by(Case.id.desc())
        if koc_id:
            q = q.where(Case.koc_id == koc_id)
        cases = list(s.scalars(q))
        if referrer:
            want = fold(referrer).replace("mudr.", "").strip()
            cases = [c for c in cases if want and want in fold((c.referring_doctor or {}).get("name", ""))]
        ids = [c.id for c in cases]
    out = []
    for cid in ids:
        result = refresh(cid)
        with session_scope() as s:
            c = s.get(Case, cid)
            row = case_summary(s, c, result)
            if mdt_only and row["state"] not in ("complete", "ready_for_mdt", "mdt_conclusion", "feedback_sent", "closed"):
                continue
            if referrer:  # what the GP sees: the result and the receipt link
                gp = s.scalars(select(OutboxMessage).where(OutboxMessage.case_id == cid,
                                                           OutboxMessage.kind == "feedback_gp")).first()
                row["feedback"] = _msg(gp) if gp else None
                row["thread"] = [_cmsg(m) for m in s.scalars(select(CaseMessage).where(
                    CaseMessage.case_id == cid, CaseMessage.to_role.in_(["gp", "coordinator"]),
                    CaseMessage.author_role.in_(["gp", "coordinator"])).order_by(CaseMessage.id))]
                row["documents_count"] = len(list(s.scalars(select(Document).where(Document.case_id == cid))))
            out.append(row)
    return out


def treatments_of(case: Case) -> list[str]:
    return list((case.decisions or {}).get("decision", {}).get("keys", []))


def treatment_label(case: Case, keys: list[str], lang: str = "cs") -> str:
    node = next((n for n in case.pathway_version.graph_json["nodes"] if n["id"] == "decision"), None)
    labels = {b["key"]: (b.get("label_en") if lang == "en" else b["label"]) or b["label"] for b in (node or {}).get("branches", [])}
    return " + ".join(labels.get(k, k) for k in keys)


# --- coordinator / doctor actions ----------------------------------------------------------------------

def _event(s: Session, case: Case, node_id: str, by: str, **data) -> None:
    if not s.scalars(select(StepEvent).where(StepEvent.case_id == case.id, StepEvent.node_id == node_id)).first():
        s.add(StepEvent(case_id=case.id, node_id=node_id, on=today(s), by=by, data=data))


def accept_case(case_id: int, by: str) -> None:
    with session_scope() as s:
        case = s.get(Case, case_id)
        case.accepted_on = today(s)
        _event(s, case, "triage", by)
        audit(s, "case.accepted", by, case_id)
    refresh(case_id)


def complete_step(case_id: int, node_id: str, by: str, note: str = "") -> None:
    with session_scope() as s:
        case = s.get(Case, case_id)
        node = next((n for n in case.pathway_version.graph_json["nodes"] if n["id"] == node_id), None)
        if not node or node.get("completion") != "manual":
            raise WorkflowError("Tento krok nelze potvrdit ručně")
        if node_id in ("mdt", "feedback"):
            raise WorkflowError("Tento krok se uzavře zápisem závěru MDT / potvrzením doručení")
        _event(s, case, node_id, by, note=note)
        if node_id == "handover_k2":
            case.k2_handover_on = today(s)
        audit(s, f"step.{node_id}.done", by, case_id, note=note)
    refresh(case_id)


def schedule_task(task_id: int, on: date | None, place: str, by: str) -> int:
    with session_scope() as s:
        t = s.get(Task, task_id)
        t.status, t.scheduled_on, t.scheduled_place = "scheduled", on, place
        audit(s, "task.scheduled", by, t.case_id, task=t.title, on=str(on), place=place)
        return t.case_id


def dismiss_task(task_id: int, by: str, reason: str) -> int:
    with session_scope() as s:
        t = s.get(Task, task_id)
        t.status, t.closed_on, t.resolution = "dismissed", today(s), reason
        audit(s, "task.dismissed", by, t.case_id, task=t.title, reason=reason)
        return t.case_id


def request_document(case_id: int, finding_key: str, by: str) -> int:
    result = refresh(case_id)
    f = next((x for x in result["findings"] if x["key"] == finding_key and x["kind"] == "missing_document"), None)
    if not f:
        raise WorkflowError("Tato chybějící zpráva už není evidována")
    with session_scope() as s:
        case = s.get(Case, case_id)
        koc = case.koc
        patient = graph.patient(case.patient_uuid)
        body = fb.doc_request_letter(patient, f["item"], f["item_date"], f["facility"], koc.name, koc.coordinator_name)
        msg = OutboxMessage(case_id=case_id, kind="doc_request", to_name=f["facility"] or "Pracoviště", to_role="externí pracoviště",
                            subject=f"Žádost o zaslání zprávy – {case.patient_name}: {f['item']}", body=body,
                            sent_on=today(s))
        s.add(msg)
        s.flush()
        s.add(DocRequest(case_id=case_id, key=finding_key, facility=f["facility"] or "", item=f["item"],
                         item_date=f["item_date"], requested_on=today(s), message_id=msg.id))
        audit(s, "doc_request.sent", by, case_id, item=f["item"], facility=f["facility"])
        msg_id = msg.id
    refresh(case_id)
    return msg_id


def review_flag(case_id: int, flag_key: str, note: str, by: str) -> None:
    with session_scope() as s:
        if not s.scalars(select(FlagReview).where(FlagReview.case_id == case_id, FlagReview.flag_key == flag_key)).first():
            s.add(FlagReview(case_id=case_id, flag_key=flag_key, note=note, by=by, on=today(s)))
        audit(s, "flag.reviewed", by, case_id, flag=flag_key, note=note)
    refresh(case_id)


def handover(case_id: int) -> dict:
    with session_scope() as s:
        case = s.get(Case, case_id)
        h = hv.build(case.patient_uuid, case.mdt_date or today(s), _entries(s, case_id), case.referring_doctor)
        h["text"] = hv.as_text(h)
        h["validated"] = bool(s.scalars(select(StepEvent).where(StepEvent.case_id == case_id,
                                                                StepEvent.node_id == "handover")).first())
        return h


def handover_entry(case_id: int, field_key: str, kind: str, value: str, by: str) -> None:
    if kind not in ("confirm", "edit", "add"):
        raise WorkflowError("kind must be confirm | edit | add")
    with session_scope() as s:
        s.add(HandoverEntry(case_id=case_id, field_key=field_key, kind=kind, value=value, by=by, on=today(s)))
        audit(s, f"handover.{kind}", by, case_id, field=field_key, value=value[:200])
    refresh(case_id)


def validate_handover(case_id: int, by: str) -> None:
    """Doctor confirms the whole handover (all fields not yet confirmed)."""
    h = handover(case_id)
    with session_scope() as s:
        case = s.get(Case, case_id)
        for sec in h["sections"]:
            for f in sec["fields"]:
                if not f["confirmed"] and f["items"]:
                    s.add(HandoverEntry(case_id=case_id, field_key=f["key"], kind="confirm", value="", by=by, on=today(s)))
        _event(s, case, "handover", by)
        audit(s, "handover.validated", by, case_id, unverified=[u["key"] for u in h["unverified"]],
              missing=[m["key"] for m in h["missing"]])
    refresh(case_id)


def set_mdt_date(case_id: int, on: date, by: str) -> None:
    with session_scope() as s:
        case = s.get(Case, case_id)
        case.mdt_date = on
        audit(s, "mdt.scheduled", by, case_id, date=str(on))
    refresh(case_id)


def _write_mdt_record(s: Session, case: Case) -> dict:
    """MDT_zapis .docx: before the meeting the briefing, after the decision the final record (sections 6/7 filled)."""
    report = mdtr.build_report(case, case.koc, case.patient_uuid, case.mdt_date, _entries(s, case.id))
    path = settings.reports_dir / f"case{case.id}_MDT_zapis_{case.mdt_date.isoformat()}.docx"
    mdtr.write_docx(report, path)
    case.mdt_report_path = _rel(path)
    return report


def generate_mdt_report(case_id: int, by: str) -> dict:
    with session_scope() as s:
        case = s.get(Case, case_id)
        if not case.mdt_date:
            raise WorkflowError("Nejprve nastavte datum MDT")
        report = _write_mdt_record(s, case)
        audit(s, "mdt.report_generated", by, case_id, path=case.mdt_report_path, final=report["final"],
              excluded=[d["title"] for d in report["excluded_documents"]])
        return report


def import_mdt_conclusion(case_id: int, filename: str, data: bytes, by: str) -> dict:
    """Store a signed MDT conclusion (.docx) and read it into a pre-filled decision form (not final)."""
    with session_scope() as s:
        case = s.get(Case, case_id)
        doc_id = _add_document(s, case, filename, data, "mdt")
        d = s.get(Document, doc_id)
        doc = read_document(_abs(d.path))
        decision = next(n for n in case.pathway_version.graph_json["nodes"] if n["id"] == "decision")
        parsed = mdtr.parse_conclusion(doc, decision["branches"])
        d.status, d.doc_type, d.title = "done", "mdt_conclusion", doc.title
        d.doc_date = doc.header.get("doc_date")
        if not case.mdt_date and d.doc_date:
            case.mdt_date = d.doc_date
        audit(s, "mdt.conclusion_imported", by, case_id, document_id=doc_id, suggested=parsed["suggested_treatments"],
              method=parsed["method"])
        return {**parsed, "document_id": doc_id}


def choose_decision(case_id: int, node_id: str, keys: list[str], by: str) -> None:
    """Record the choice at a decision node (e.g. lung: curative / non-radical / no biopsy)."""
    with session_scope() as s:
        case = s.get(Case, case_id)
        node = next((n for n in case.pathway_version.graph_json["nodes"] if n["id"] == node_id and n["type"] == "decision"), None)
        if not node:
            raise WorkflowError("Neznámé rozhodnutí / Unknown decision")
        allowed = {b["key"] for b in node["branches"]}
        if not keys or not set(keys) <= allowed:
            raise WorkflowError("Neplatná volba / Invalid option")
        if len(keys) > 1 and not node.get("multi"):
            raise WorkflowError("Zde lze zvolit jen jednu možnost / Only one option allowed here")
        case.decisions = {**(case.decisions or {}), node_id: {"keys": keys, "on": today(s).isoformat(), "by": by}}
        audit(s, "decision.made", by, case_id, node=node_id, keys=keys)
    refresh(case_id)


def record_mdt_decision(case_id: int, treatments: list[str], conclusion: str, recommendations: list[str], by: str,
                        diagnosis: str = "", members: list[str] | None = None, document_id: int | None = None) -> None:
    """The MDT panel records the meeting: chosen treatments + structured conclusion. Closes the MDT step."""
    if not treatments:
        raise WorkflowError("Zvolte alespoň jednu léčbu / Choose at least one treatment")
    if not conclusion.strip():
        raise WorkflowError("Doplňte závěr MDT / Write the MDT conclusion")
    with session_scope() as s:
        case = s.get(Case, case_id)
        if not case.mdt_date:
            case.mdt_date = today(s)
        case.mdt_conclusion = {"diagnosis": diagnosis, "conclusion": conclusion.strip(),
                               "recommendations": [r for r in recommendations if r.strip()],
                               "next_appointment": next((r for r in recommendations if re.search(r"termín|\d{1,2}\.\s*\d{1,2}\.\s*\d{4}", r)), None),
                               "treatments": treatments, "members": members or [], "document_id": document_id,
                               "recorded_by": by, "recorded_on": today(s).isoformat()}
        if not s.scalars(select(StepEvent).where(StepEvent.case_id == case_id, StepEvent.node_id == "mdt")).first():
            s.add(StepEvent(case_id=case_id, node_id="mdt", on=case.mdt_date, by=by, data={"document_id": document_id}))
        audit(s, "mdt.decision_recorded", by, case_id, treatments=treatments)
    choose_decision(case_id, "decision", treatments, by)
    with session_scope() as s:  # the record now carries the conclusion → regenerate it as the final MDT record
        case = s.get(Case, case_id)
        _write_mdt_record(s, case)
        audit(s, "mdt.record_finalised", by, case_id, path=case.mdt_report_path)


def send_feedback(case_id: int, by: str) -> dict:
    with session_scope() as s:
        case = s.get(Case, case_id)
        if not case.mdt_conclusion or not treatments_of(case):
            raise WorkflowError("Nejprve musí MDT zapsat rozhodnutí / The MDT decision must be recorded first")
        koc = case.koc
        patient = graph.patient(case.patient_uuid)
        branch_label = treatment_label(case, treatments_of(case))
        h = hv.build(case.patient_uuid, case.mdt_date, _entries(s, case_id), case.referring_doctor)
        report = _write_mdt_record(s, case)  # always the final record with conclusion + recommendations
        attachments = [
            {"name": "Zápis z jednání MDT (závěr a doporučení)", "report_path": case.mdt_report_path},
            {"name": "Závěr MDT – podepsaný originál", "document_id": case.mdt_conclusion.get("document_id")},
            {"name": "Handover – původní kontext případu", "text": hv.as_text(h)},
        ]
        attachments = [a for a in attachments if a.get("document_id") or a.get("report_path") or a.get("text")]
        subject, body = fb.gp_feedback(case, koc, patient, case.mdt_conclusion, branch_label, hv.as_text(h))
        token = secrets.token_urlsafe(16)
        rd = case.referring_doctor or {}
        gp = OutboxMessage(case_id=case_id, kind="feedback_gp", to_name=rd.get("name", "Referující lékař"),
                           to_role="referující lékař", to_address=rd.get("practice", ""), subject=subject, body=body,
                           attachments=attachments, sent_on=today(s), ack_token=token)
        review_token = secrets.token_urlsafe(16)
        subject2, body2 = fb.review_doctor_feedback(case, koc, patient, case.mdt_conclusion, branch_label, report["results"])
        rev = OutboxMessage(case_id=case_id, kind="feedback_review", to_name=f"Revizní lékař ZP {patient.get('insurer', '')}",
                            to_role="revizní lékař", subject=subject2, body=body2,
                            attachments=[x for x in attachments if x.get("document_id") or x.get("report_path")],
                            sent_on=today(s), ack_token=review_token)
        s.add_all([gp, rev])
        audit(s, "feedback.sent", by, case_id, to=[gp.to_name, rev.to_name])
        s.flush()
        out = {"gp_message_id": gp.id, "review_message_id": rev.id, "ack_token": token, "review_token": review_token}
    refresh(case_id)
    return out


def acknowledge(token: str, by: str) -> int:
    with session_scope() as s:
        m = s.scalars(select(OutboxMessage).where(OutboxMessage.ack_token == token)).first()
        if not m:
            raise WorkflowError("Neplatný odkaz")
        if not m.acked_on:
            m.acked_on, m.acked_by = today(s), by
            if m.kind == "feedback_gp":  # only the GP's receipt closes the feedback step
                _event(s, s.get(Case, m.case_id), "feedback", by, message_id=m.id)
            audit(s, "feedback.acknowledged", by, m.case_id, message_id=m.id, kind=m.kind)
        case_id = m.case_id
    refresh(case_id)
    return case_id


def message_by_token(token: str) -> dict:
    with session_scope() as s:
        m = s.scalars(select(OutboxMessage).where(OutboxMessage.ack_token == token)).first()
        if not m:
            raise WorkflowError("Neplatný odkaz")
        return _msg(m)


def outbox(case_id: int | None = None) -> list[dict]:
    with session_scope() as s:
        q = select(OutboxMessage).order_by(OutboxMessage.id.desc())
        if case_id:
            q = q.where(OutboxMessage.case_id == case_id)
        return [_msg(m) for m in s.scalars(q)]


def audit_log(case_id: int) -> list[dict]:
    with session_scope() as s:
        return [{"on": a.on, "at": a.at, "actor": a.actor, "action": a.action, "detail": a.detail}
                for a in s.scalars(select(AuditLog).where(AuditLog.case_id == case_id).order_by(AuditLog.id))]


def delete_case(case_id: int) -> None:
    """Demo reset of one case (removes its graph data, rows and raw files)."""
    with session_scope() as s:
        case = s.get(Case, case_id)
        p_uuid = case.patient_uuid
        for model in (Task, DocRequest, HandoverEntry, FlagReview, StepEvent, AuditLog, CaseMessage):
            for row in s.scalars(select(model).where(model.case_id == case_id)):
                s.delete(row)
        for m in s.scalars(select(OutboxMessage).where(OutboxMessage.case_id == case_id)):
            s.delete(m)
        for d in s.scalars(select(Document).where(Document.case_id == case_id)):
            s.delete(d)
        s.delete(case)
        others = s.scalars(select(Case).where(Case.patient_uuid == p_uuid)).first()
    if not others:
        graph.delete_patient(p_uuid)
        shutil.rmtree(settings.raw_dir / p_uuid, ignore_errors=True)


def to_json(obj) -> str:
    return json.dumps(obj, default=str, ensure_ascii=False)


# --- messages: coordinator <-> referring doctor, review doctor -> coordinator --------------------------------

def _cmsg(m: CaseMessage) -> dict:
    return {"id": m.id, "author_role": m.author_role, "author": m.author, "to_role": m.to_role, "body": m.body,
            "reply_to": m.reply_to, "resolved": m.resolved, "on": m.on, "at": m.at}


def case_messages(case_id: int) -> list[dict]:
    with session_scope() as s:
        return [_cmsg(m) for m in s.scalars(select(CaseMessage).where(CaseMessage.case_id == case_id).order_by(CaseMessage.id))]


def post_message(case_id: int, author_role: str, author: str, body: str, to_role: str | None = None,
                 reply_to: int | None = None) -> int:
    """coordinator -> gp (question), gp -> coordinator (answer), coordinator -> review (answer)."""
    if author_role not in ("coordinator", "gp", "review"):
        raise WorkflowError("unknown role")
    if not body.strip():
        raise WorkflowError("Zpráva je prázdná / The message is empty")
    to_role = to_role or ("gp" if author_role == "coordinator" else "coordinator")
    with session_scope() as s:
        case = s.get(Case, case_id)
        if not case:
            raise WorkflowError("Neznámý případ")
        # an answer closes the open questions addressed to its author
        answered = list(s.scalars(select(CaseMessage).where(CaseMessage.case_id == case_id, CaseMessage.to_role == author_role,
                                                          CaseMessage.resolved.is_(False))))
        if reply_to:
            answered = [m for m in answered if m.id == reply_to] or answered
        if author_role == "coordinator" and to_role == "gp":
            answered = [m for m in answered if m.author_role == "gp"]  # a new question to the GP is not an answer
        for m in answered:
            m.resolved = True
        is_answer = bool(answered)
        msg = CaseMessage(case_id=case_id, author_role=author_role, author=author, to_role=to_role, body=body.strip(),
                          reply_to=reply_to or (answered[-1].id if answered else None), resolved=is_answer, on=today(s))
        s.add(msg)
        if author_role == "coordinator" and to_role == "gp" and not is_answer:
            s.add(OutboxMessage(case_id=case_id, kind="question_gp", to_name=(case.referring_doctor or {}).get("name", "PL"),
                                to_role="referující lékař", subject=f"Dotaz z KOC – {case.patient_name}", body=body.strip(),
                                sent_on=today(s)))
        audit(s, f"message.{author_role}", author, case_id, to=to_role, answer=is_answer)
        s.flush()
        msg_id = msg.id
    refresh(case_id)
    return msg_id


def draft_question(case_id: int) -> str:
    """Pre-filled question to the referring doctor from the handover fields that are still missing."""
    h = handover(case_id)
    with session_scope() as s:
        case = s.get(Case, case_id)
        coordinator, koc_name, patient = case.koc.coordinator_name, case.koc.name, case.patient_name
    missing = [m["label"] for m in h["missing"]]
    if not missing:
        return ""
    items = "\n".join(f"- {m}" for m in missing)
    return (f"Dobrý den,\n\npro jednání MDT u pacienta/pacientky {patient} prosíme o doplnění těchto údajů:\n{items}\n\n"
            f"Odpovědět můžete přímo v Onkomostu (Moji pacienti), případně nahrát dokument.\n\n"
            f"Děkujeme,\n{coordinator}, koordinátor/ka {koc_name}")


def review_question(token: str, by: str, body: str) -> int:
    """The insurer's review doctor asks the coordinator for more information from their message link."""
    with session_scope() as s:
        m = s.scalars(select(OutboxMessage).where(OutboxMessage.ack_token == token)).first()
        if not m or m.kind != "feedback_review":
            raise WorkflowError("Neplatný odkaz")
        case_id = m.case_id
    return post_message(case_id, "review", by, body, to_role="coordinator")



def notifications(koc_id: int | None = None) -> list[dict]:
    """Deadline watch for the coordinator: overdue / due today or tomorrow, and questions waiting for the KOC."""
    with session_scope() as s:
        now = today(s)
        q = select(Task, Case).join(Case, Task.case_id == Case.id).where(Task.status.in_(["open", "scheduled"]))
        if koc_id:
            q = q.where(Case.koc_id == koc_id)
        out = []
        for t, c in s.execute(q).all():
            question = t.kind == "question" and not t.external
            if t.external and not t.due_on:
                continue
            if question:  # someone is waiting for an answer from the KOC
                level = "question"
            elif t.due_on and t.due_on < now:
                level = "overdue"
            elif t.due_on and (t.due_on - now).days <= 1:
                level = "due_soon"
            else:
                continue
            out.append({"case_id": c.id, "patient": c.patient_name, "task_id": t.id, "title": t.title,
                        "title_en": t.title_en or t.title, "kind": t.kind, "due_on": t.due_on, "level": level,
                        "owner_name": t.owner_name, "external": t.external})
        order = {"question": 0, "overdue": 1, "due_soon": 2}
        return sorted(out, key=lambda x: (order[x["level"]], x["due_on"] or date.max))
