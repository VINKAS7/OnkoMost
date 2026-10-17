"""GET /api/cases/{id}/medications – current medication up to the MDT date (or today) with its ADME organ sites and
interaction candidates, for the MDT anatomogram (backend/reports/adme.py). Included by backend/api.py."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.encoders import jsonable_encoder

from backend.reports import adme
from backend.workflow.db import Case, session_scope, today

router = APIRouter()


@router.get("/api/cases/{case_id}/medications")
def medications(case_id: int):
    with session_scope() as s:
        case = s.get(Case, case_id)
        if not case:
            raise HTTPException(404)
        p_uuid, cutoff = case.patient_uuid, case.mdt_date or today(s)
    return jsonable_encoder({**adme.case_medications(p_uuid, cutoff), "cutoff": cutoff})
