"""Patient identity (name + RČ + date of birth) read from one uploaded document: the header rules
(reader.parse_header) plus the LLM, which also finds the identity when the document has no standard header.

The LLM must quote the text it read each value from. A value whose quote is not in the document, or an RČ that
is not a valid birth number, is dropped ("copy, don't guess"). Rules and LLM are merged per field: agreement →
both sources, disagreement → the rule value wins and the field carries `conflict` for the user to see.
"""
from __future__ import annotations

import re
from datetime import date
from pathlib import Path

from pydantic import BaseModel

from backend.extract import llm
from backend.ingest.identity import rc_info
from backend.ingest.reader import DocText, fold, read_document

HEAD_CHARS = 4000  # identity is in the header; the LLM only sees the beginning of the document


class _LlmIdentity(BaseModel):
    patient_name: str | None = None
    name_quote: str | None = None  # asked for so the model reads from the text; the check is word by word
    rc: str | None = None
    rc_quote: str | None = None


INSTRUCTION = (
    "Find the PATIENT's identity in this Czech medical document: the patient's full name (first name + surname, "
    "without titles) and the birth number (rodné číslo, RČ, format 123456/7890). Not the doctor's, not a contact "
    "person's. For each value give `*_quote`: the exact text of the document line it is in. "
    "If a value is not in the document, return null."
)


def _norm_rc(v: str | None) -> str:
    digits = re.sub(r"\D", "", v or "")
    return f"{digits[:6]}/{digits[6:]}" if len(digits) in (9, 10) else ""


def _plausible_name(v: str | None) -> bool:
    """Two or more words of letters (no digits / contact data picked up by a header rule)."""
    return bool(v) and not re.search(r"[\d@+·|]", v) and len(v.split()) >= 2


def _in_text(quote: str | None, text: str) -> bool:
    q = re.sub(r"\s+", " ", (quote or "").strip())
    return bool(q) and q in re.sub(r"\s+", " ", text)


def _llm(doc: DocText) -> tuple[dict, str]:
    """{patient_name?, rc?} verified against the text, plus an error text when the LLM is unavailable."""
    text = doc.full_text[:HEAD_CHARS]
    try:
        x = llm.extract(_LlmIdentity, INSTRUCTION, text)
    except llm.LLMUnavailable as e:
        return {}, str(e)
    out: dict = {}
    # every word of the name must be in the text (first name and surname may sit on separate lines)
    words = set(re.findall(r"\w+", fold(text)))
    if _plausible_name(x.patient_name) and all(w in words for w in re.findall(r"\w+", fold(x.patient_name))):
        out["patient_name"] = x.patient_name.strip()
    rc = _norm_rc(x.rc)
    if rc and rc_info(rc) and _in_text(x.rc_quote, text) and re.sub(r"\D", "", rc) in re.sub(r"\D", "", x.rc_quote or ""):
        out["rc"] = rc
    return out, ""


def from_doc(doc: DocText, use_llm: bool = True) -> dict:
    """Merged identity of a read document:
    {patient_name, rc, dob, fields: {name: {value, source, conflict?}}, llm_error?}."""
    h = doc.header
    name = (h.get("patient_name") or "").strip()
    rules = {"patient_name": name if _plausible_name(name) else "", "rc": _norm_rc(h.get("rc"))}
    ai, err = _llm(doc) if use_llm else ({}, "")
    fields: dict = {}
    for k in ("patient_name", "rc"):
        r, a = rules.get(k), ai.get(k)
        same = r and a and (fold(r).split() == fold(a).split() if k == "patient_name" else r == a)
        if r and a and not same:
            fields[k] = {"value": r, "source": "pravidla", "conflict": a}
        elif r or a:
            fields[k] = {"value": r or a, "source": "pravidla + AI" if same else ("pravidla" if r else "AI")}
    rc = fields.get("rc", {}).get("value", "")
    dob: date | None = h.get("dob") or rc_info(rc).get("dob") if rc else h.get("dob")
    out = {"patient_name": fields.get("patient_name", {}).get("value", ""), "rc": rc, "dob": dob, "fields": fields}
    if err:
        out["llm_error"] = err
    return out


def scan(path: Path, use_llm: bool = True) -> dict:
    return from_doc(read_document(path), use_llm)


def compare(found: dict, patient_name: str, rc: str) -> list[str]:
    """Differences between a document's identity and the one entered / stored (empty = consistent or unknown)."""
    issues = []
    if found.get("rc") and rc and re.sub(r"\D", "", found["rc"]) != re.sub(r"\D", "", rc):
        issues.append(f"RČ {found['rc']} ≠ {rc}")
    if found.get("patient_name") and patient_name and fold(found["patient_name"]).split() != fold(patient_name).split():
        issues.append(f"Jméno „{found['patient_name']}“ ≠ „{patient_name}“")
    return issues


def header_for_check(doc: DocText) -> dict:
    """The document header for identity.check_identity, with name / RČ filled in by the LLM when the rules
    found none or a header line that is not a name (documents without the standard 'Pacient: … RČ …' header)."""
    h = dict(doc.header)
    if not _plausible_name(h.get("patient_name")):
        h.pop("patient_name", None)
    if h.get("patient_name") and h.get("rc"):
        return h
    found = from_doc(doc)
    for k in ("patient_name", "rc"):
        if not h.get(k) and found.get(k):
            h[k] = found[k]
    return h
