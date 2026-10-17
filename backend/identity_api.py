"""Patient identity from uploaded documents (rules + LLM, backend/ingest/identity_scan.py) and the user's
decisions on a mismatch. The system only shows the discrepancy; the user decides:

    POST   /api/identity/scan                 a file (PDF, DOCX, DOC, TXT) → name + RČ found + differences from the
                                              name / RČ entered (GP referral form fills empty fields from it)
    POST   /api/documents/{id}/identity/keep  keep a document whose identity differs → processed normally, marked
    DELETE /api/documents/{id}                remove an uploaded document (row, graph + FHIR DocumentReference, file)
    PUT    /api/cases/{id}/identity           update the patient's name / RČ (typed, or taken from a document); the
                                              other documents are re-checked and their differences shown, never
                                              re-blocked – documents blocked only for identity that now match are
                                              processed

Included by backend/api.py (app.include_router).
"""
from __future__ import annotations

import hashlib
import re
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel
from sqlalchemy import select

from backend.config import settings
from backend.fhir import records
from backend.graph.store import graph
from backend.ingest import identity_scan
from backend.ingest.identity import check_identity, rc_info
from backend.ingest.reader import read_document
from backend.workflow import service as svc
from backend.workflow.db import Case, DocRequest, Document, audit, session_scope

router = APIRouter()


@router.post("/api/identity/scan")
async def scan(file: UploadFile = File(...), patient_name: str = Form(""), rc: str = Form("")):
    data = await file.read()
    tmp = settings.raw_dir / "_incoming"
    tmp.mkdir(parents=True, exist_ok=True)
    tp = tmp / f"scan-{hashlib.sha256(data).hexdigest()}{Path(file.filename or '').suffix.lower()}"
    tp.write_bytes(data)
    try:
        found = identity_scan.scan(tp)
    except Exception as e:  # noqa: BLE001 – unreadable / unsupported file: the user sees why
        raise HTTPException(400, f"Soubor {file.filename} nelze přečíst: {e}") from e
    finally:
        tp.unlink(missing_ok=True)
    return jsonable_encoder({"filename": file.filename, "found": found,
                             "issues": identity_scan.compare(found, patient_name, rc)})


class ByIn(BaseModel):
    by: str = "koordinátor"


@router.post("/api/documents/{doc_id}/identity/keep")
def keep(doc_id: int, body: ByIn):
    with session_scope() as s:
        d = s.get(Document, doc_id)
        if not d:
            raise HTTPException(404)
        d.identity = {**(d.identity or {}), "accepted": body.by}
        d.status = "queued"
        audit(s, "document.identity_kept", body.by, d.case_id, doc_id=doc_id, issues=d.identity.get("issues", []))
    svc.enqueue(doc_id)
    return {"ok": True}


@router.delete("/api/documents/{doc_id}")
def delete(doc_id: int, by: str = "koordinátor"):
    with session_scope() as s:
        d = s.get(Document, doc_id)
        if not d:
            raise HTTPException(404)
        case = s.get(Case, d.case_id)
        case_id, path, sha = d.case_id, d.path, d.sha256
        shared = s.scalars(select(Document).where(Document.path == path, Document.id != doc_id)).first()
        graph.delete_document(f"{case.patient_uuid}:{sha}")
        audit(s, "document.deleted", by, case_id, doc_id=doc_id, filename=d.filename, sha256=sha)
        for r in s.scalars(select(DocRequest).where(DocRequest.document_id == doc_id)):  # requested report: waiting again
            r.status, r.received_on, r.document_id = "requested", None, None
        s.flush()
        s.delete(d)
    if not shared:
        svc._abs(path).unlink(missing_ok=True)
    svc.refresh(case_id)
    return {"ok": True}


class IdentityIn(BaseModel):
    patient_name: str = ""
    rc: str = ""
    from_document: int | None = None  # take name / RČ found in this document
    by: str = "koordinátor"


@router.put("/api/cases/{case_id}/identity")
def update_identity(case_id: int, body: IdentityIn):
    name, rc = body.patient_name.strip(), re.sub(r"\s", "", body.rc)
    if body.from_document:
        with session_scope() as s:
            d = s.get(Document, body.from_document)
            if not d or d.case_id != case_id:
                raise HTTPException(404)
            path = svc._abs(d.path)
        found = identity_scan.scan(path)
        name, rc = name or found["patient_name"], rc or found["rc"]
    if rc and not re.fullmatch(r"\d{6}/?\d{3,4}", rc):
        raise HTTPException(400, "Rodné číslo musí mít tvar 123456/7890.")
    if rc and "/" not in rc:
        rc = f"{rc[:6]}/{rc[6:]}"
    if not name and not rc:
        raise HTTPException(400, "Není co změnit – jméno ani RČ nebylo zadáno ani nalezeno.")
    with session_scope() as s:
        case = s.get(Case, case_id)
        if not case:
            raise HTTPException(404)
        p_uuid, before = case.patient_uuid, case.identity
    info = rc_info(rc) if rc else {}
    # the pseudonymous patient_uuid stays: it keys the graph, the FHIR resources and the stored files
    after = records.upsert_patient(p_uuid, {"patient_name": name, "rc": rc, "dob": info.get("dob"), "sex": info.get("sex")})
    rechecked, reprocess = 0, []
    with session_scope() as s:
        audit(s, "patient.identity_updated", body.by, case_id, from_document=body.from_document,
              before={k: str(before.get(k, "")) for k in ("patient_name", "rc")},
              after={k: str(after.get(k, "")) for k in ("patient_name", "rc")})
        for d in s.scalars(select(Document).where(Document.case_id == case_id)):
            try:
                doc = read_document(svc._abs(d.path))
            except Exception:  # noqa: BLE001 – unreadable files keep their old result
                continue
            ident = check_identity(identity_scan.header_for_check(doc), after.get("rc", ""), after.get("patient_name", ""),
                                   after.get("dob"))
            if (d.identity or {}).get("accepted"):
                ident = {**ident, "ok": True, "accepted": d.identity["accepted"]}
            if d.status == "blocked" and ident["ok"]:
                d.status = "queued"
                reprocess.append(d.id)
            d.identity = ident
            rechecked += 1
    for doc_id in reprocess:
        svc.enqueue(doc_id)
    svc.refresh(case_id)
    return jsonable_encoder({"identity": {k: after.get(k) for k in ("patient_name", "rc", "dob")},
                             "rechecked": rechecked, "reprocessed": reprocess})
