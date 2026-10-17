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


REPORT = ["pdf", "docx", "doc"]
SCAN = ["dcm", "dicom", "pdf", "docx", "jpg", "jpeg", "png", "tiff"]


def standard_tail(feeders: list[str]) -> tuple[list[dict], list[dict]]:
    """handover → treatment MDT → decision to treat (5 options, multi) → feedback → K2 → closed."""
    nodes = [
        {"id": "handover", "type": "step", "label": "Handover potvrzen lékařem", "label_en": "Handover validated by doctor",
         "phase": "mdt", "owner_role": "koc_doctor", "sla_days": 2, "completion": "manual", "action": "Potvrdit handover",
         "description": "Lékař KOC zkontroluje handover a potvrdí, že případ je připraven na MDT.",
         "description_en": "The KOC doctor checks the handover and confirms the case is ready for the MDT.",
         "why": "Na MDT jde jen úplný a ověřený podklad: diagnóza, staging, výkonnostní stav (ECOG) a komorbidity. ESMO staví volbu léčby na těchto údajích.",
         "why_en": "Only a complete, checked dossier goes to the MDT: diagnosis, stage, performance status (ECOG) and comorbidities. ESMO bases the choice of treatment on these."},
        {"id": "mdt", "type": "mdt", "label": "Léčebné MDT", "label_en": "Treatment MDT",
         "phase": "mdt", "owner_role": "mdt", "sla_days": 7, "completion": "manual", "action": "Zapsat závěr MDT",
         "description": "Multidisciplinární tým zapíše diagnózu, závěr a doporučení léčby.",
         "description_en": "The multidisciplinary team records the diagnosis, conclusion and treatment advice.",
         "why": "Všechna doporučení ESMO (plíce, pankreas, prs) vyžadují, aby léčebnou strategii stanovil multidisciplinární tým; u karcinomu pankreatu MDT v expertním centru [III, A].",
         "why_en": "All ESMO guidelines used here (lung, pancreas, breast) require the treatment strategy to be set by a multidisciplinary tumour board; for pancreatic cancer at an expert centre [III, A]."},
        {"id": "decision", "type": "decision", "label": "Rozhodnutí o léčbě", "label_en": "Decision to treat",
         "phase": "mdt", "owner_role": "mdt", "sla_days": 0, "completion": "branch", "multi": True,
         "description": "MDT vybere jeden nebo více léčebných plánů (sledování, paliace, chemo, radio, operace).",
         "description_en": "The MDT picks one or more treatment plans (watch, palliative, chemo, radio, surgery).",
         "why": "Závěr MDT musí být zaznamenán jako konkrétní plán, aby ho koordinátor léčby (K2) mohl zajistit.",
         "why_en": "The MDT's conclusion has to be recorded as a concrete plan so the treatment coordinator (K2) can carry it out.",
         "branches": [{"key": k, "label": cs, "label_en": en} for k, cs, en in TREATMENTS]},
        *[{"id": f"plan_{k}", "type": "treatment", "label": cs, "label_en": en, "phase": "treatment",
           "owner_role": "k2_coordinator", "completion": "branch",
           "description": f"Zvolená léčba: {cs}.", "description_en": f"Chosen treatment: {en}.",
           "why": "Větev otevře jen rozhodnutí MDT.", "why_en": "Only the MDT decision opens this branch."}
          for k, cs, en in TREATMENTS],
        {"id": "feedback", "type": "feedback", "label": "Výsledek PL + revizní lékař", "label_en": "Result to GP + review doctor",
         "phase": "after_mdt", "owner_role": "coordinator", "sla_days": 2, "completion": "manual", "action": "Odeslat výsledek",
         "description": "Koordinátor odešle závěr MDT referujícímu lékaři a reviznímu lékaři.",
         "description_en": "The coordinator sends the MDT result to the referring doctor and the review doctor.",
         "why": "Uzavírá smyčku s referujícím lékařem: ví, co bylo rozhodnuto a co dál.",
         "why_en": "Closes the loop with the referring doctor: they learn what was decided and what happens next."},
        {"id": "handover_k2", "type": "handover", "label": "Předání koordinátorovi léčby (K2)",
         "label_en": "Handover to treatment coordinator (K2)", "phase": "after_mdt", "owner_role": "coordinator",
         "sla_days": 3, "completion": "manual", "action": "Předat K2",
         "description": "Případ se předává koordinátorovi léčby (K2) k realizaci plánu.",
         "description_en": "The case is handed to the treatment coordinator (K2) to carry out the plan.",
         "why": "Diagnostická cesta končí předáním; léčbu vede koordinátor léčby.",
         "why_en": "The diagnostic pathway ends with the handover; treatment is run by the treatment coordinator."},
        {"id": "closed", "type": "end", "label": "Uzavřeno", "label_en": "Closed", "phase": "after_mdt",
         "owner_role": "coordinator", "completion": "auto",
         "description": "Cesta je uzavřená – diagnostika a rozhodnutí jsou hotové.",
         "description_en": "The pathway is closed – diagnostics and the decision are done.",
         "why": "Konec diagnostické cesty.", "why_en": "End of the diagnostic pathway."},
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
            else:
                # keep structure of running versions; refresh title/description/formats from seed
                src = {n["id"]: n for n in pw["graph"]["nodes"]}
                for v in row.versions:
                    if (v.graph_json or {}).get("version_label"):  # versions from seed/pathways/versions keep their texts
                        continue
                    g = copy.deepcopy(v.graph_json)
                    for n in g.get("nodes") or []:
                        snode = src.get(n["id"])
                        if not snode:
                            continue
                        for key in ("description", "description_en", "why", "why_en", "accepted_formats", "label",
                                    "label_en"):
                            if snode.get(key):
                                n[key] = snode[key]
                    v.graph_json = g
        add_versions(s)
        if clock:
            set_today(s, clock)


def add_versions(s) -> None:
    """Extra pathway versions (seed/pathways/versions/*.json: {code, version_label, status, guideline_source?, graph}),
    added once each – keyed by graph.version_label. An "active" one retires the current active version; running
    cases keep the version they started on."""
    from datetime import datetime
    for f in sorted((SEED / "pathways" / "versions").glob("*.json")):
        v = json.loads(f.read_text(encoding="utf-8"))
        p = s.scalars(select(Pathway).where(Pathway.code == v["code"])).first()
        if not p or any((x.graph_json or {}).get("version_label") == v["version_label"] for x in p.versions):
            continue
        validate(v["graph"])
        base = next((x for x in p.versions if x.status == "active"), None)
        if v.get("status") == "active" and base:
            base.status = "retired"
        s.add(PathwayVersion(pathway_id=p.id, version=max(x.version for x in p.versions) + 1, status=v.get("status", "draft"),
                             graph_json={**v["graph"], "version_label": v["version_label"]},
                             based_on_version_id=base.id if base else None,
                             activated_at=datetime.utcnow() if v.get("status") == "active" else None))
        if v.get("guideline_source"):
            p.guideline_source = v["guideline_source"]


if __name__ == "__main__":
    seed()
    print("seeded")
