"""Replay the Rakathon sample case (Alena Procházková) through Onkomost, day by day.

    python -m scripts.seed_demo                 # whole story, ends with the case closed
    python -m scripts.seed_demo --until accepted  # stop early and continue live in the UI
    python -m scripts.seed_demo --reset-only      # wipe Onkomost data (SQLite + :Onk nodes only)

Steps: referral → accepted → prior_reports → ct → biopsy → labs → histology → ready → mdt → feedback → closed
"""
from __future__ import annotations

import argparse
import sys
import time
from datetime import date

from backend.config import settings
from backend.graph.store import graph
from backend.seed import seed
from backend.workflow import service as svc
from backend.workflow.db import engine, session_scope, set_today

STEPS = ["referral", "accepted", "prior_reports", "ct", "biopsy", "labs", "histology", "ready", "mdt", "feedback", "closed"]
P = settings.sample_data_dir / "Pacient"
COORD, DOCTOR, GP = "Bc. Lucie Dvořáková", "MUDr. Martin Svoboda", "MUDr. Tomáš Řezníček"


def pathway_id(code: str) -> int:
    from sqlalchemy import select
    from backend.workflow.db import Pathway
    with session_scope() as s:
        return s.scalars(select(Pathway).where(Pathway.code == code)).one().id


def clock(d: date) -> None:
    with session_scope() as s:
        set_today(s, d)


def upload(case_id: int, name: str, source: str = "upload") -> None:
    f = P / name
    t = time.time()
    svc.add_document(case_id, f.name, f.read_bytes(), source=source, sync=True)
    print(f"   + {name} ({time.time() - t:.0f}s)")


def reset() -> None:
    from backend.workflow.db import Base
    Base.metadata.drop_all(engine)
    print(f"Neo4j: removed {graph.reset()} Onkomost nodes (other data untouched)")


def run(until: str) -> int:
    stop = STEPS.index(until)
    say = lambda i, msg: print(f"[{STEPS[i]}] {msg}")  # noqa: E731

    clock(date(2026, 10, 2))
    f = P / "07_PL_zadost_KOC2_2026-10-02.docx"
    case_id = svc.create_referral(2, [(f.name, f.read_bytes())], actor=GP, sync=True, pathway_id=pathway_id("pancreas"),
                                  patient_name="Alena Procházková", rc="635722/1013",
                                  referrer={"name": GP, "practice": "Ordinace praktického lékaře, Dolní Břežany"})
    say(0, f"2. 10. GP refers Alena Procházková to KOC 2 → case #{case_id}")
    if stop == 0:
        return case_id

    clock(date(2026, 10, 3))
    svc.accept_case(case_id, COORD)
    d = svc.case_detail(case_id)
    for t in d["tasks"]:
        if t["kind"] == "missing_document" and t["status"] == "open":
            svc.request_document(case_id, t["key"], COORD)
    ct = next(t for t in svc.case_detail(case_id)["tasks"] if t["key"] == "step:ct")
    svc.schedule_task(ct["id"], date(2026, 10, 8), "KOC 1 – Nemocnice Severní, Radiologická klinika (v KOC 2 bez termínu)", COORD)
    say(1, "3. 10. coordinator accepts, requests 5 prior reports, books CT at KOC 1 for 8. 10.")
    if stop == 1:
        return case_id

    clock(date(2026, 10, 6))
    for name in ["01_Kardiologie_2026-07-20.docx", "02_Laborator_2026-09-01.docx", "03_RTG_plic_2026-09-03.docx",
                 "04_PL_epikriza_2026-09-04.docx", "05_Gastroenterologie_2026-09-15.docx", "06_UZ_bricha_2026-09-29.docx"]:
        upload(case_id, name, "request")
    say(2, "6. 10. requested reports arrive (01–06)")
    if stop == 2:
        return case_id

    clock(date(2026, 10, 8))
    upload(case_id, "08_CT_KOC1_2026-10-08.docx")
    d = svc.case_detail(case_id)
    for key, on, place in [("step:biopsy", date(2026, 10, 12), "KOC 2 – Endoskopie"),
                           ("step:labs", date(2026, 10, 15), "KOC 2 – Laboratoř")]:
        t = next((t for t in d["tasks"] if t["key"] == key and t["status"] == "open"), None)
        if t:
            svc.schedule_task(t["id"], on, place, COORD)
    say(3, "8. 10. CT result from KOC 1; biopsy and blood tests booked")
    if stop == 3:
        return case_id

    clock(date(2026, 10, 12))
    upload(case_id, "09_Biopsie_vykon_KOC2_2026-10-12.docx")
    say(4, "12. 10. EUS-FNB biopsy done")
    if stop == 4:
        return case_id

    clock(date(2026, 10, 15))
    upload(case_id, "10_Laborator_KOC2_2026-10-15.docx")
    svc.set_mdt_date(case_id, date(2026, 10, 21), COORD)
    say(5, "15. 10. blood tests + tumour markers; MDT booked for 21. 10.")
    if stop == 5:
        return case_id

    clock(date(2026, 10, 19))
    upload(case_id, "11_Histologie_KOC2_2026-10-19.docx")
    say(6, "19. 10. histology: ductal adenocarcinoma → all pre-MDT steps done")
    if stop == 6:
        return case_id

    clock(date(2026, 10, 20))
    d = svc.case_detail(case_id)
    for fnd in d["findings"]:
        if fnd["kind"] == "mismatch" and not fnd["reviewed"]:
            svc.review_flag(case_id, fnd["key"], "Ověřit s provádějícím pracovištěm; předneseno na MDT.", DOCTOR)
    svc.validate_handover(case_id, DOCTOR)
    svc.generate_mdt_report(case_id, COORD)
    say(7, "20. 10. doctor reviews flags + validates handover; MDT report generated")
    if stop == 7:
        return case_id

    clock(date(2026, 10, 21))
    f = settings.sample_data_dir / "MDT zaver.docx"
    parsed = svc.import_mdt_conclusion(case_id, f.name, f.read_bytes(), "MDT")
    svc.record_mdt_decision(case_id, parsed["suggested_treatments"] or ["chemotherapy"], parsed["conclusion"],
                            parsed["recommendations"], "doc. MUDr. Pavel Hrubý, Ph.D.", parsed["diagnosis"],
                            parsed["members"], parsed["document_id"])
    say(8, f"21. 10. MDT decides: {parsed['suggested_treatments']} (neoadjuvant chemotherapy, then re-assess)")
    if stop == 8:
        return case_id

    clock(date(2026, 10, 22))
    out = svc.send_feedback(case_id, COORD)
    say(9, "22. 10. MDT conclusion sent to GP + insurer review doctor")
    if stop == 9:
        return case_id

    clock(date(2026, 10, 23))
    svc.acknowledge(out["ack_token"], GP)
    svc.complete_step(case_id, "handover_k2", COORD, "Předáno koordinátorovi onkologické léčby (konzilium 4. 11.)")
    say(10, "23. 10. GP confirms receipt; case handed over to K2 → closed")
    clock(date(2026, 10, 27))
    upload(case_id, "12_Algeziologie_2026-10-26.docx")
    upload(case_id, "13_Psychologie_KOC2_2026-10-27.docx")
    print("   (post-MDT pain + psychology reports added; they are excluded from the MDT report)")
    return case_id


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--until", choices=STEPS, default="closed")
    ap.add_argument("--reset-only", action="store_true")
    ap.add_argument("--keep", action="store_true", help="do not wipe existing Onkomost data first")
    a = ap.parse_args()
    if not P.is_dir():
        sys.exit(f"Sample data not found: {P} (set SAMPLE_DATA_DIR in backend/.env)")
    if not a.keep:
        reset()
    if a.reset_only:
        seed()
        return
    seed()
    t = time.time()
    case_id = run(a.until)
    d = svc.case_detail(case_id)
    print(f"\nCase #{case_id}: state={d['state']} queue={d['queue']} ({time.time() - t:.0f}s)")
    if d["next_task"]:
        nt = d["next_task"]
        print(f"Next: {nt['title']} – {nt['owner_name']} (due {nt['due_on']})")


if __name__ == "__main__":
    main()
