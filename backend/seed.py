"""Seed KOCs and the cancer pathways (seed/pathways/*.json). Idempotent."""
from __future__ import annotations

import copy
import json
from datetime import date

from sqlalchemy import select

from backend.config import ROOT
from backend.graph.store import graph
from backend.pathway.model import validate
from backend.workflow.db import Koc, Pathway, PathwayVersion, init_db, session_scope, set_today

SEED = ROOT / "seed"

TREATMENTS = [
    ("active_monitoring", "Aktivní sledování", "Active monitoring"),
    ("palliative", "Paliativní péče", "Palliative care"),
    ("chemotherapy", "Chemoterapie", "Chemotherapy"),
    ("radiotherapy", "Radioterapie", "Radiotherapy"),
    ("surgery", "Chirurgická léčba", "Surgery"),
]


def standard_tail(feeders: list[str]) -> tuple[list[dict], list[dict]]:
    """handover → treatment MDT → decision to treat (5 options, multi) → feedback → K2 → closed."""
    nodes = [
        {"id": "handover", "type": "step", "label": "Handover potvrzen lékařem", "label_en": "Handover validated by doctor",
         "phase": "mdt", "owner_role": "koc_doctor", "sla_days": 2, "completion": "manual", "action": "Potvrdit handover"},
        {"id": "mdt", "type": "mdt", "label": "Léčebné MDT", "label_en": "Treatment MDT",
         "phase": "mdt", "owner_role": "mdt", "sla_days": 7, "completion": "manual", "action": "Zapsat závěr MDT"},
        {"id": "decision", "type": "decision", "label": "Rozhodnutí o léčbě", "label_en": "Decision to treat",
         "phase": "mdt", "owner_role": "mdt", "sla_days": 0, "completion": "branch", "multi": True,
         "branches": [{"key": k, "label": cs, "label_en": en} for k, cs, en in TREATMENTS]},
        *[{"id": f"plan_{k}", "type": "treatment", "label": cs, "label_en": en, "phase": "treatment",
           "owner_role": "k2_coordinator", "completion": "branch"} for k, cs, en in TREATMENTS],
        {"id": "feedback", "type": "feedback", "label": "Výsledek PL + revizní lékař", "label_en": "Result to GP + review doctor",
         "phase": "after_mdt", "owner_role": "coordinator", "sla_days": 2, "completion": "manual", "action": "Odeslat výsledek"},
        {"id": "handover_k2", "type": "handover", "label": "Předání koordinátorovi léčby (K2)",
         "label_en": "Handover to treatment coordinator (K2)", "phase": "after_mdt", "owner_role": "coordinator",
         "sla_days": 3, "completion": "manual", "action": "Předat K2"},
        {"id": "closed", "type": "end", "label": "Uzavřeno", "label_en": "Closed", "phase": "after_mdt",
         "owner_role": "coordinator", "completion": "auto"},
    ]
    edges = [{"source": f, "target": "handover"} for f in feeders] + [
        {"source": "handover", "target": "mdt"}, {"source": "mdt", "target": "decision"},
        *[{"source": "decision", "target": f"plan_{k}", "branch": k} for k, _, _ in TREATMENTS],
        *[{"source": f"plan_{k}", "target": "feedback"} for k, _, _ in TREATMENTS],
        {"source": "feedback", "target": "handover_k2"}, {"source": "handover_k2", "target": "closed"},
    ]
    return nodes, edges


def load_pathways() -> list[dict]:
    out = []
    for f in sorted((SEED / "pathways").glob("*.json")):
        pw = json.loads(f.read_text(encoding="utf-8"))
        g = copy.deepcopy(pw["graph"])
        if pw.get("tail") == "standard":
            n, e = standard_tail(pw["tail_from"])
            g["nodes"] += n
            g["edges"] += e
        validate(g)
        pw["graph"] = g
        out.append(pw)
    return sorted(out, key=lambda p: p.get("order", 99))


def seed(clock: date | None = None) -> None:
    init_db()
    graph.ensure_schema()
    with session_scope() as s:
        for k in json.loads((SEED / "kocs.json").read_text(encoding="utf-8")):
            row = s.scalars(select(Koc).where(Koc.code == k["code"])).first()
            if not row:
                s.add(Koc(**k))
            else:
                for key, v in k.items():
                    setattr(row, key, v)
        for pw in load_pathways():
            row = s.scalars(select(Pathway).where(Pathway.code == pw["code"])).first()
            if not row:
                row = Pathway(code=pw["code"], name=pw["name"], name_en=pw.get("name_en", pw["name"]),
                              cancer_type=pw["cancer_type"], icd_codes=pw["icd_codes"],
                              guideline_source=pw["guideline_source"], order=pw.get("order", 99))
                s.add(row)
                s.flush()
                s.add(PathwayVersion(pathway_id=row.id, version=1, status="active", graph_json=pw["graph"]))
        if clock:
            set_today(s, clock)


if __name__ == "__main__":
    seed()
    print("seeded")
