"""Onkomost REST API.  Run from the repo root:

    conda run -n Deep_Learning uvicorn backend.api:app --port 8000 --reload
"""
from __future__ import annotations

import logging
from datetime import date

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.encoders import jsonable_encoder
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy import select

from backend.config import ROOT, settings
from backend.extract import llm
from backend.fhir.client import fhir
from backend.graph.store import graph
from backend.identity_api import router as identity_router
from backend.pathway import governance as gov
from backend.pathway.generate import generate as generate_pathway
from backend.pathway.model import ROLES, validate
from backend.seed import seed
from backend.workflow import service as svc
from backend.workflow.db import (ChangeProposal, Document, Koc, Pathway, PathwayVersion, session_scope, set_today,
                                 today)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logging.getLogger("httpx").setLevel(logging.WARNING)

app = FastAPI(title="Onkomost API", version="0.1")
app.include_router(identity_router)  # identity from documents + mismatch decisions (backend/identity_api.py)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                   allow_methods=["*"], allow_headers=["*"])


@app.on_event("startup")
def _startup() -> None:
    seed()
    svc.start_worker()


@app.exception_handler(svc.WorkflowError)
@app.exception_handler(gov.GovernanceError)
async def _domain_error(_: Request, exc: Exception):
    return JSONResponse(status_code=400, content={"detail": str(exc)})


@app.exception_handler(ValueError)
async def _value_error(_: Request, exc: ValueError):
    return JSONResponse(status_code=400, content={"detail": str(exc)})


@app.exception_handler(llm.LLMUnavailable)
async def _llm_unavailable(_: Request, exc: llm.LLMUnavailable):
    return JSONResponse(status_code=503, content={"detail": str(exc)})


def ok(data=None):
    return jsonable_encoder(data if data is not None else {"ok": True})


# --- system --------------------------------------------------------------------------------------

@app.get("/api/health")
def health():
    try:
        iris_info = graph.ping()
    except Exception as e:  # noqa: BLE001
        iris_info = f"ERROR: {e}"
    try:
        fhir_info = fhir.ping()
    except Exception as e:  # noqa: BLE001
        fhir_info = f"ERROR: {e}"
    with session_scope() as s:
        t = today(s)
    return ok({"iris": iris_info, "fhir": fhir_info, "llm": llm.available(), "model": settings.llm_model, "today": t,
               "queue": svc.queue_size()})


class ClockIn(BaseModel):
    today: date


@app.post("/api/clock")
def set_clock(body: ClockIn):
    with session_scope() as s:
        set_today(s, body.today)
        gov.close_due(s)
    return ok({"today": body.today})


@app.get("/api/kocs")
def kocs():
    with session_scope() as s:
        return ok([{"id": k.id, "code": k.code, "name": k.name, "city": k.city, "coordinator_name": k.coordinator_name,
                    "active": k.active} for k in s.scalars(select(Koc).order_by(Koc.id))])


@app.get("/api/roles")
def roles():
    return ok(ROLES)


# --- cases ---------------------------------------------------------------------------------------

@app.post("/api/referrals")
async def referral(koc_id: int = Form(...), pathway_id: int = Form(...), patient_name: str = Form(...),
                   rc: str = Form(...), files: list[UploadFile] = File(...), referrer_name: str = Form(""),
                   referrer_practice: str = Form(""), referrer_email: str = Form(""), referrer_phone: str = Form("")):
    """GP portal: patient name + birth number (RČ) + detected cancer type + documents."""
    data = [(f.filename, await f.read()) for f in files]
    referrer = {"name": referrer_name, "practice": referrer_practice, "email": referrer_email, "phone": referrer_phone}
    case_id = svc.create_referral(koc_id, data, referrer_name or "Referující lékař", pathway_id=pathway_id,
                                  patient_name=patient_name, rc=rc, referrer=referrer)
    return ok({"case_id": case_id})


@app.get("/api/cases")
def cases(koc_id: int | None = None, referrer: str | None = None, mdt: bool = False):
    return ok(svc.list_cases(koc_id, referrer=referrer, mdt_only=mdt))


@app.get("/api/cases/{case_id}")
def case(case_id: int):
    return ok(svc.case_detail(case_id))


@app.delete("/api/cases/{case_id}")
def delete_case(case_id: int):
    svc.delete_case(case_id)
    return ok()


@app.post("/api/cases/{case_id}/documents")
async def upload(case_id: int, files: list[UploadFile] = File(...), source: str = Form("upload"),
                 actor: str = Form("koordinátor")):
    ids = [svc.add_document(case_id, f.filename, await f.read(), source, actor) for f in files]
    return ok({"document_ids": ids})


@app.get("/api/documents/{doc_id}/raw")
def raw(doc_id: int):
    with session_scope() as s:
        d = s.get(Document, doc_id)
        if not d:
            raise HTTPException(404)
        path = svc._abs(d.path)
        name = d.filename
    return FileResponse(path, filename=name)


@app.post("/api/documents/{doc_id}/reprocess")
def reprocess(doc_id: int):
    svc.reprocess(doc_id)
    return ok()


class ActorIn(BaseModel):
    by: str = "koordinátor"
    note: str = ""


@app.post("/api/cases/{case_id}/accept")
def accept(case_id: int, body: ActorIn):
    svc.accept_case(case_id, body.by)
    return ok()


@app.post("/api/cases/{case_id}/steps/{node_id}/complete")
def complete(case_id: int, node_id: str, body: ActorIn):
    svc.complete_step(case_id, node_id, body.by, body.note)
    return ok()


class RequestIn(BaseModel):
    finding_key: str
    by: str = "koordinátor"


@app.post("/api/cases/{case_id}/doc-requests")
def doc_request(case_id: int, body: RequestIn):
    return ok({"message_id": svc.request_document(case_id, body.finding_key, body.by)})


class FlagIn(BaseModel):
    flag_key: str
    note: str
    by: str = "lékař KOC"


@app.post("/api/cases/{case_id}/flags/review")
def review_flag(case_id: int, body: FlagIn):
    svc.review_flag(case_id, body.flag_key, body.note, body.by)
    return ok()


class ScheduleIn(BaseModel):
    on: date | None = None
    place: str = ""
    by: str = "koordinátor"


@app.post("/api/tasks/{task_id}/schedule")
def schedule(task_id: int, body: ScheduleIn):
    return ok({"case_id": svc.schedule_task(task_id, body.on, body.place, body.by)})


class DismissIn(BaseModel):
    reason: str
    by: str = "koordinátor"


@app.post("/api/tasks/{task_id}/dismiss")
def dismiss(task_id: int, body: DismissIn):
    return ok({"case_id": svc.dismiss_task(task_id, body.by, body.reason)})


@app.get("/api/cases/{case_id}/handover")
def handover(case_id: int):
    return ok(svc.handover(case_id))


@app.get("/api/cases/{case_id}/handover.txt", response_class=PlainTextResponse)
def handover_text(case_id: int):
    return svc.handover(case_id)["text"]


class EntryIn(BaseModel):
    field_key: str
    kind: str
    value: str = ""
    by: str = "lékař KOC"


@app.post("/api/cases/{case_id}/handover/entries")
def handover_entry(case_id: int, body: EntryIn):
    svc.handover_entry(case_id, body.field_key, body.kind, body.value, body.by)
    return ok()


@app.post("/api/cases/{case_id}/handover/validate")
def handover_validate(case_id: int, body: ActorIn):
    svc.validate_handover(case_id, body.by)
    return ok()


@app.get("/api/cases/{case_id}/graph")
def case_graph(case_id: int, cutoff: date | None = None):
    with session_scope() as s:
        from backend.workflow.db import Case
        c = s.get(Case, case_id)
        p_uuid = c.patient_uuid
    return ok(graph.view(p_uuid, cutoff))


@app.get("/api/cases/{case_id}/audit")
def case_audit(case_id: int):
    return ok(svc.audit_log(case_id))


# --- MDT & feedback ------------------------------------------------------------------------------

class MdtDateIn(BaseModel):
    date: date
    by: str = "koordinátor"


@app.post("/api/cases/{case_id}/mdt/date")
def mdt_date(case_id: int, body: MdtDateIn):
    svc.set_mdt_date(case_id, body.date, body.by)
    return ok()


@app.post("/api/cases/{case_id}/mdt/report")
def mdt_report(case_id: int, body: ActorIn):
    return ok(svc.generate_mdt_report(case_id, body.by))


@app.get("/api/cases/{case_id}/mdt/brief")
def mdt_brief(case_id: int):
    """MDT_zapis content as JSON (read-only preview for the MDT workspace; nothing is written)."""
    from backend.reports import mdt as mdtr
    from backend.workflow.db import Case
    with session_scope() as s:
        c = s.get(Case, case_id)
        cutoff = c.mdt_date or today(s)
        return ok(mdtr.build_report(c, c.koc, c.patient_uuid, cutoff, svc._entries(s, case_id)))


@app.get("/api/cases/{case_id}/bodymap")
def bodymap(case_id: int):
    """Organs affected by the cancer, read by the LLM from the reports up to the MDT date (see reports/bodymap.py)."""
    from backend.reports import bodymap as bm
    return ok(bm.status(case_id))


@app.post("/api/cases/{case_id}/bodymap")
def bodymap_run(case_id: int):
    from backend.reports import bodymap as bm
    return ok(bm.start(case_id))


@app.get("/api/cases/{case_id}/mdt/report.docx")
def mdt_report_docx(case_id: int):
    with session_scope() as s:
        from backend.workflow.db import Case
        c = s.get(Case, case_id)
        if not c.mdt_report_path:
            raise HTTPException(404, "report not generated yet")
        path = svc._abs(c.mdt_report_path)
    return FileResponse(path, filename=path.name)


@app.post("/api/cases/{case_id}/mdt/import")
async def mdt_import(case_id: int, file: UploadFile = File(...), by: str = Form("MDT")):
    """Read a signed MDT conclusion (.docx) into a pre-filled decision form."""
    return ok(svc.import_mdt_conclusion(case_id, file.filename, await file.read(), by))


class MdtDecisionIn(BaseModel):
    treatments: list[str]
    conclusion: str
    recommendations: list[str] = []
    diagnosis: str = ""
    members: list[str] = []
    document_id: int | None = None
    by: str = "MDT"


@app.post("/api/cases/{case_id}/mdt/decision")
def mdt_decision(case_id: int, body: MdtDecisionIn):
    svc.record_mdt_decision(case_id, body.treatments, body.conclusion, body.recommendations, body.by,
                            body.diagnosis, body.members, body.document_id)
    return ok()


class DecisionIn(BaseModel):
    node_id: str
    keys: list[str]
    by: str = "koordinátor"


@app.post("/api/cases/{case_id}/decisions")
def decision(case_id: int, body: DecisionIn):
    svc.choose_decision(case_id, body.node_id, body.keys, body.by)
    return ok()


class AskIn(BaseModel):
    question: str
    lang: str = "en"


@app.post("/api/cases/{case_id}/ask")
def ask(case_id: int, body: AskIn):
    """GraphRAG over the patient's documents (only those dated on/before the MDT date)."""
    from backend.rag.ask import ask as rag_ask
    with session_scope() as s:
        from backend.workflow.db import Case
        c = s.get(Case, case_id)
        p_uuid, cutoff = c.patient_uuid, c.mdt_date or today(s)
    return ok(rag_ask(p_uuid, body.question, cutoff, body.lang))


@app.post("/api/cases/{case_id}/feedback")
def feedback(case_id: int, body: ActorIn):
    return ok(svc.send_feedback(case_id, body.by))


@app.get("/api/outbox")
def outbox(case_id: int | None = None):
    return ok(svc.outbox(case_id))


class MessageIn(BaseModel):
    author_role: str
    author: str
    body: str
    to_role: str | None = None
    reply_to: int | None = None


@app.get("/api/cases/{case_id}/messages")
def messages(case_id: int):
    return ok(svc.case_messages(case_id))


@app.post("/api/cases/{case_id}/messages")
def post_message(case_id: int, body: MessageIn):
    return ok({"id": svc.post_message(case_id, body.author_role, body.author, body.body, body.to_role, body.reply_to)})


@app.get("/api/cases/{case_id}/messages/draft")
def draft_message(case_id: int):
    return ok({"body": svc.draft_question(case_id)})


class QuestionIn(BaseModel):
    by: str
    body: str


@app.post("/api/ack/{token}/question")
def review_question(token: str, body: QuestionIn):
    """The insurer's review doctor asks the coordinator for more information (slide 11)."""
    return ok({"id": svc.review_question(token, body.by, body.body)})


@app.get("/api/notifications")
def notifications(koc_id: int | None = None):
    return ok(svc.notifications(koc_id or None))


@app.get("/api/ack/{token}")
def ack_view(token: str):
    m = svc.message_by_token(token)
    return ok(m)


class AckIn(BaseModel):
    by: str


@app.post("/api/ack/{token}")
def ack(token: str, body: AckIn):
    return ok({"case_id": svc.acknowledge(token, body.by)})


# --- pathways & governance ----------------------------------------------------------------------------

@app.get("/api/pathways")
def pathways():
    with session_scope() as s:
        gov.close_due(s)
        out = []
        for p in s.scalars(select(Pathway).order_by(Pathway.order)):
            out.append({"id": p.id, "code": p.code, "name": p.name, "name_en": p.name_en, "cancer_type": p.cancer_type,
                        "icd_codes": p.icd_codes,
                        "active_version_id": next((v.id for v in p.versions if v.status == "active"), None),
                        "guideline_source": p.guideline_source,
                        "versions": [{"id": v.id, "version": v.version, "status": v.status,
                                      "label": (v.graph_json or {}).get("version_label"),
                                      "created_by_koc_id": v.created_by_koc_id, "created_at": v.created_at,
                                      "activated_at": v.activated_at} for v in p.versions]})
        return ok(out)


@app.get("/api/pathway-versions/{version_id}")
def pathway_version(version_id: int):
    with session_scope() as s:
        v = s.get(PathwayVersion, version_id)
        return ok({"id": v.id, "pathway_id": v.pathway_id, "pathway": v.pathway.name, "pathway_en": v.pathway.name_en,
                   "icd_codes": v.pathway.icd_codes, "guideline_source": v.pathway.guideline_source,
                   "version": v.version,
                   "status": v.status, "graph": v.graph_json, "based_on_version_id": v.based_on_version_id,
                   "created_by_koc_id": v.created_by_koc_id})


class DraftIn(BaseModel):
    koc_id: int
    graph: dict | None = None
    blank: bool = False


@app.post("/api/pathways/{pathway_id}/drafts")
def create_draft(pathway_id: int, body: DraftIn):
    return ok({"version_id": gov.create_draft(pathway_id, body.koc_id, body.graph, blank=body.blank)})


class NewPathwayIn(BaseModel):
    koc_id: int
    name: str = ""
    name_en: str = ""
    icd_codes: list[str] | str
    guideline_source: str = ""


@app.post("/api/pathways")
def create_pathway(body: NewPathwayIn):
    """A new cancer type: returns its draft v1, which goes to the vote like any change."""
    return ok({"version_id": gov.create_pathway(body.koc_id, body.name, body.name_en, body.icd_codes,
                                                body.guideline_source)})


@app.put("/api/pathways/{pathway_id}")
def update_pathway(pathway_id: int, body: NewPathwayIn):
    gov.update_pathway_info(pathway_id, body.koc_id, body.name, body.name_en, body.icd_codes, body.guideline_source)
    return ok()


@app.delete("/api/pathway-versions/{version_id}")
def discard_draft(version_id: int, koc_id: int):
    gov.discard_draft(version_id, koc_id)
    return ok()


@app.put("/api/pathway-versions/{version_id}")
def update_draft(version_id: int, body: DraftIn):
    gov.update_draft(version_id, body.graph, body.koc_id)
    return ok()


@app.post("/api/pathway-versions/validate")
def validate_graph(body: dict):
    try:
        validate(body)
        return ok({"valid": True})
    except ValueError as e:
        return ok({"valid": False, "error": str(e)})


class GenerateIn(BaseModel):
    prompt: str
    current: dict | None = None


@app.post("/api/pathway-versions/generate")
def generate_graph(body: GenerateIn):
    prompt = (body.prompt or "").strip()
    if len(prompt) < 8:
        raise ValueError("Write a few sentences about the steps first.")
    return ok({"graph": generate_pathway(prompt, body.current)})


class ProposalIn(BaseModel):
    draft_version_id: int
    title: str
    rationale: str
    deadline: date
    koc_id: int


@app.post("/api/proposals")
def submit(body: ProposalIn):
    return ok({"proposal_id": gov.submit(body.draft_version_id, body.title, body.rationale, body.deadline, body.koc_id)})


@app.get("/api/proposals")
def proposals():
    with session_scope() as s:
        gov.close_due(s)
        return ok([gov.proposal_view(s, p) for p in s.scalars(select(ChangeProposal).order_by(ChangeProposal.id.desc()))])


@app.get("/api/proposals/{proposal_id}")
def proposal(proposal_id: int):
    with session_scope() as s:
        gov.close_due(s)
        return ok(gov.proposal_view(s, s.get(ChangeProposal, proposal_id)))


class VoteIn(BaseModel):
    koc_id: int
    choice: str
    comment: str = ""


@app.post("/api/proposals/{proposal_id}/votes")
def vote(proposal_id: int, body: VoteIn):
    return ok(gov.cast_vote(proposal_id, body.koc_id, body.choice, body.comment))


# --- frontend (production build) ---------------------------------------------------------------------

DIST = ROOT / "frontend" / "dist"
if DIST.is_dir():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}")
    def spa(path: str):
        f = DIST / path
        return FileResponse(f if path and f.is_file() else DIST / "index.html")
