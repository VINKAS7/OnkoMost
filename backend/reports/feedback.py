"""Messages that leave the KOC: document requests, feedback to the GP and to the insurer's review doctor.

Feedback content is built from structured data (never invented). MedGemma only phrases the short document
request letters, with a template fallback.
"""
from __future__ import annotations

from datetime import date

from backend.extract import medgemma


def _d(x) -> str:
    return f"{x.day}. {x.month}. {x.year}" if x else ""


def doc_request_letter(patient: dict, item: str, item_date: date | None, facility: str, koc_name: str,
                       coordinator: str) -> str:
    facts = (f"Odesílatel: {coordinator}, koordinátor/ka {koc_name}\nAdresát: {facility or 'pracoviště'}\n"
             f"Pacient: {patient.get('patient_name')}, RČ {patient.get('rc')}\n"
             f"Požadovaná zpráva: {item} ze dne {_d(item_date)}\n"
             "Důvod: pacient/ka byl/a předán/a do péče KOC k dokončení onkologické diagnostiky; výsledek je potřeba "
             "pro multidisciplinární tým (MDT).")
    template = (f"Dobrý den,\n\nprosíme o zaslání zprávy „{item}“ ze dne {_d(item_date)} pro pacienta/ku "
                f"{patient.get('patient_name')} (RČ {patient.get('rc')}). Pacient/ka byl/a předán/a do péče {koc_name} "
                f"k dokončení onkologické diagnostiky a výsledek potřebujeme pro jednání MDT.\n\n"
                f"Děkujeme,\n{coordinator}\nkoordinátor/ka {koc_name}")
    try:
        text = medgemma.write("Napiš krátkou žádost (max. 6 vět) o zaslání lékařské zprávy. Podepiš odesílatele.", facts)
        text = text.replace("**", "").replace("__", "").strip()
        # Guard: the draft must name the patient and the item, otherwise use the template.
        if patient.get("patient_name", "").split()[-1] in text and item.split()[0].lower() in text.lower():
            return text
    except medgemma.LLMUnavailable:
        pass
    return template


def gp_feedback(case, koc, patient: dict, conclusion: dict, branch_label: str, handover_text: str) -> tuple[str, str]:
    subject = f"Závěr MDT – {patient.get('patient_name')} ({_d(case.mdt_date)})"
    recs = "\n".join(f"  {r}" for r in conclusion.get("recommendations", []))
    body = f"""Vážený pane doktore / Vážená paní doktorko,

posíláme výsledek jednání multidisciplinárního týmu ({koc.name}) o Vašem pacientovi / Vaší pacientce, kterého/kterou jste k nám referoval/a dne {_d(case.created_on)}.

Pacient: {patient.get('patient_name')}, RČ {patient.get('rc')}, ZP {patient.get('insurer')}
Datum MDT: {_d(case.mdt_date)}

DIAGNÓZA
{conclusion.get('diagnosis') or '—'}

ZÁVĚR MDT
{conclusion.get('conclusion') or '—'}

DOPORUČENÍ MDT
{recs or '—'}

Zvolený další postup: {branch_label}
{('Další termín: ' + conclusion['next_appointment']) if conclusion.get('next_appointment') else ''}

V příloze najdete plný zápis z MDT a strukturovaný přehled podkladů, ze kterých MDT vycházelo (původní kontext případu).
Prosíme o potvrzení převzetí kliknutím na odkaz níže.

S pozdravem
{koc.coordinator_name}, koordinátor/ka {koc.name}
{koc.coordinator_email}
"""
    return subject, body


def review_doctor_feedback(case, koc, patient: dict, conclusion: dict, branch_label: str, exams: list[dict]) -> tuple[str, str]:
    subject = f"[Automaticky] Ukončení diagnostické fáze – {patient.get('patient_name')}, ZP {patient.get('insurer')}"
    exam_lines = "\n".join(f"  - {_d(e['date'])}: {e['exam']}" for e in exams)
    body = f"""Automatická informace pro revizního lékaře ZP {patient.get('insurer')} (strukturovaný přehled).

Pacient: {patient.get('patient_name')}, RČ {patient.get('rc')}
Centrum: {koc.name}
Referováno: {_d(case.created_on)}  ·  Převzato: {_d(case.accepted_on)}  ·  MDT: {_d(case.mdt_date)}
Doba od referování do MDT: {(case.mdt_date - case.created_on).days if case.mdt_date else '—'} dní

Diagnóza: {conclusion.get('diagnosis') or '—'}
Rozhodnutí MDT: {branch_label}

Provedená vyšetření v diagnostické fázi:
{exam_lines or '  —'}

Doplňující informace si lze vyžádat přímo u koordinátora: {koc.coordinator_name} ({koc.coordinator_email}).
"""
    return subject, body
