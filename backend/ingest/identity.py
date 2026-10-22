"""Patient identity: RČ (Czech personal number) + name + date of birth.

A document whose RČ, name or birth date disagrees with the case is blocked ("wrong patient?"). Images (DICOM) are
checked by name and birth date only, see check_dicom_identity.
"""
from __future__ import annotations

import uuid
from datetime import date

from backend.ingest.reader import fold

NAMESPACE = uuid.UUID("6f1c8a52-2c55-4c8e-9a39-0b4e8f0d1c11")


def rc_info(rc: str) -> dict:
    """Birth date and sex encoded in an RČ (YYMMDD/XXXX; women have month + 50)."""
    digits = rc.replace("/", "")
    if len(digits) < 9 or not digits[:6].isdigit():
        return {}
    yy, mm, dd = int(digits[:2]), int(digits[2:4]), int(digits[4:6])
    sex = "F" if mm > 50 else "M"
    if mm > 50:
        mm -= 50
    if mm > 20:  # extra +20 used after 2004 when numbers ran out
        mm -= 20
    # 9-digit numbers are pre-1954; 10-digit: 00–53 → 2000s, else 1900s
    century = 1900 if len(digits) == 9 or yy >= 54 else 2000
    try:
        return {"dob": date(century + yy, mm, dd), "sex": sex}
    except ValueError:
        return {"sex": sex}


def patient_uuid(rc: str) -> str:
    return str(uuid.uuid5(NAMESPACE, rc.replace("/", "").strip()))


def age_on(dob: date, on: date) -> int:
    return on.year - dob.year - ((on.month, on.day) < (dob.month, dob.day))


def check_identity(header: dict, case_rc: str, case_name: str, case_dob: date | None) -> dict:
    """Return {"ok": bool, "issues": [...], "matched_on": [...]}."""
    issues, matched = [], []
    rc = header.get("rc")
    name = header.get("patient_name")
    dob = header.get("dob")
    if rc:
        if case_rc and rc.replace("/", "") != case_rc.replace("/", ""):
            issues.append(f"RČ {rc} ≠ {case_rc}")
        else:
            matched.append("rc")
        info = rc_info(rc)
        if dob and info.get("dob") and info["dob"] != dob:
            issues.append(f"Datum narození {dob:%d. %m. %Y} neodpovídá RČ {rc}")
    else:
        issues.append("Dokument neobsahuje rodné číslo")
    if name:
        if case_name and fold(name).split() != fold(case_name).split():
            issues.append(f"Jméno „{name}“ ≠ „{case_name}“")
        else:
            matched.append("name")
    if dob:
        if case_dob and dob != case_dob:
            issues.append(f"Datum narození {dob:%d. %m. %Y} ≠ {case_dob:%d. %m. %Y}")
        else:
            matched.append("dob")
    # Missing RČ alone is a warning, not a block, if the name matches.
    blocking = [i for i in issues if not i.startswith("Dokument neobsahuje")] or (
        ["Nelze ověřit identitu"] if not matched else [])
    return {"ok": not blocking, "issues": issues, "matched_on": matched}


NO_IDENTITY_IN_IMAGES = "Snímky neobsahují identitu pacienta – potvrzeno nahrávajícím"


def check_dicom_identity(meta: dict, case_name: str, case_dob: date | None) -> dict:
    """Images rarely carry an RČ, and exported or research images are often de-identified ("LUNG1-131").
    A real name or birth date that differs from the case blocks the series; no identity at all is accepted on the
    uploader's word and stays visible as a note."""
    issues, matched = [], []
    # DICOM person names are "Family^Given"; a pseudonym has digits or no letters at all
    name = " ".join((meta.get("patient_name") or "").replace("^", " ").split())
    is_name = bool(name) and not meta.get("identity_removed") and all(w.isalpha() for w in name.split())
    if is_name:
        if case_name and sorted(fold(name).split()) != sorted(fold(case_name).split()):
            issues.append(f"Jméno ve snímcích „{name}“ ≠ „{case_name}“")
        else:
            matched.append("name")
    dob = meta.get("birth_date")
    if dob and case_dob:
        if dob != case_dob:
            issues.append(f"Datum narození ve snímcích {dob:%d. %m. %Y} ≠ {case_dob:%d. %m. %Y}")
        else:
            matched.append("dob")
    if issues:
        return {"ok": False, "issues": issues, "matched_on": matched}
    return {"ok": True, "issues": [] if matched else [NO_IDENTITY_IN_IMAGES], "matched_on": matched}
