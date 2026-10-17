"""Document type from the title/headings (rules). The LLM is only asked when no rule matches."""
from __future__ import annotations

import re

from backend.ingest.reader import DocText, fold

# (doc_type, exam_type or None, pattern on folded title+first lines). Order matters.
RULES: list[tuple[str, str | None, str]] = [
    ("referral", None, r"zadost o prevzeti"),
    ("mdt_conclusion", None, r"zapis z jednani multidisciplinarniho"),
    ("histology", "histology", r"biopticky nalez|histolog"),
    ("procedure", "bronchoscopy", r"bronchoskop|ebus"),
    ("procedure", "colonoscopy", r"koloskop|kolonoskop"),
    ("procedure", "eus_fnb", r"protokol o vykonu|eus-fnb"),
    ("lab", "lab", r"vysledky laboratorniho"),
    ("imaging", "pet_ct", r"\bpet\b"),  # before CT: "PET-CT" contains "CT"
    ("imaging", "ct", r"\bct\b"),
    ("imaging", "ultrasound", r"\buz\b|ultrazvuk"),
    ("imaging", "xray", r"\brtg\b"),
    ("imaging", "mri", r"\bmr\b|magnetick"),
    ("imaging", "mammography", r"mamograf"),
    ("gp_summary", None, r"epikriza"),
    ("pain_report", "pain_consult", r"algeziolog|lecby bolesti|lecba bolesti"),
    ("psychology_report", "psych_consult", r"psycholog|psychoonkolog"),
    ("specialist_report", "specialist_visit", r"ambulantni zprava"),
]

EXAM_LABELS = {
    "histology": "Histologie (bioptický nález)",
    "eus_fnb": "EUS-FNB (endosonografie s biopsií)",
    "lab": "Laboratorní vyšetření",
    "ct": "CT",
    "ultrasound": "UZ (ultrazvuk)",
    "xray": "RTG",
    "mri": "MR",
    "pet_ct": "PET-CT",
    "bronchoscopy": "Bronchoskopie / EBUS s biopsií",
    "colonoscopy": "Koloskopie s biopsií",
    "mammography": "Mamografie",
    "pain_consult": "Algeziologické vyšetření",
    "psych_consult": "Psychologické vyšetření",
    "specialist_visit": "Odborné ambulantní vyšetření",
}


def classify(doc: DocText) -> tuple[str, str | None]:
    head = fold(" ".join([doc.title] + [b.text for b in doc.blocks[:8] if b.kind == "p"]))
    title = fold(doc.title)
    for doc_type, exam, pat in RULES:
        # imaging rules must match the title, not e.g. "RTG plic" mentioned in a GP letter's history
        target = title if doc_type == "imaging" else head
        if re.search(pat, target):
            return doc_type, exam
    return "other", None


def facility_display(doc: DocText) -> str:
    lines = doc.header.get("facility_lines", [])
    if not lines:
        return ""
    first = lines[0]
    if len(lines) > 1:
        second = lines[1]
        is_address = bool(re.search(r"\d{3}\s?\d{2}", second))
        is_person = bool(re.match(r"(?:doc\.\s*)?(MUDr|Mgr|Ing|RNDr|Bc)\.", second))
        if not is_address and not is_person and len(second) < 70:
            return f"{first} – {second}"
    return first


def specialty(doc: DocText) -> str:
    """Rough specialty of a specialist report from the facility/author lines."""
    t = fold(" ".join(doc.header.get("facility_lines", []) + [doc.header.get("author_role", "")]))
    for key, label in [("kardiolog", "Kardiologie"), ("gastroenterolog", "Gastroenterologie"),
                       ("algeziolog", "Algeziologie"), ("psycholog", "Psychologie"), ("onkolog", "Onkologie")]:
        if key in t:
            return label
    return ""
