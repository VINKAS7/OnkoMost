"""Repair a sketched pathway into a valid graph (no LLM)."""
from backend.pathway.generate import materialize
from backend.pathway.model import validate


def test_materialize_fills_descriptions_formats_and_required_nodes():
    g = materialize({
        "nodes": [
            {"kind": "start", "label": "Žádost PL", "label_en": "GP referral", "doc_type": "referral"},
            {"kind": "document", "id": "ct", "label": "CT hrudníku", "label_en": "Chest CT",
             "description": "Zpráva z CT hrudníku.", "description_en": "Chest CT report."},
            {"kind": "mdt", "id": "mdt", "label": "Léčebné MDT", "label_en": "Treatment MDT"},
            {"kind": "decision", "id": "decision", "label": "Léčba", "label_en": "Treatment",
             "branches": [
                 {"key": "chemo", "label": "Chemoterapie", "label_en": "Chemotherapy"},
                 {"key": "surgery", "label": "Operace", "label_en": "Surgery"},
             ]},
            {"kind": "treatment", "id": "plan_chemo", "label": "Chemoterapie", "label_en": "Chemotherapy"},
            {"kind": "treatment", "id": "plan_surgery", "label": "Operace", "label_en": "Surgery"},
        ],
        "edges": [
            {"source": "start", "target": "ct"},
            {"source": "ct", "target": "mdt"},
            {"source": "mdt", "target": "decision"},
            {"source": "decision", "target": "plan_chemo", "branch": "chemo"},
            {"source": "decision", "target": "plan_surgery", "branch": "surgery"},
        ],
    })
    validate(g)
    by = {n["id"]: n for n in g["nodes"]}
    assert any(n["type"] == "feedback" for n in g["nodes"])
    assert any(n["type"] == "end" for n in g["nodes"])
    ct = by["ct"]
    assert ct["completion"] == "evidence"
    assert ct["description"] and ct["description_en"]
    assert "dcm" in ct["accepted_formats"] or "dicom" in ct["accepted_formats"]
    assert {"pdf", "docx"} & set(ct["accepted_formats"])
    assert any(r.get("kind") == "described" for r in ct["requires"])
    assert any(r.get("exam_type") == "ct" for r in ct["requires"])
    start = next(n for n in g["nodes"] if n["type"] == "start")
    assert start["description_en"]
    decision = next(n for n in g["nodes"] if n["type"] == "decision")
    keys = {b["key"] for b in decision["branches"]}
    assert keys >= {"chemo", "surgery"}
    branched = {(e["source"], e.get("branch")) for e in g["edges"] if e.get("branch")}
    assert (decision["id"], "chemo") in branched
    assert (decision["id"], "surgery") in branched


def test_materialize_linear_brief_without_edges():
    g = materialize({
        "nodes": [
            {"kind": "step", "label": "Triáž", "label_en": "Triage"},
            {"kind": "document", "label": "Histologie", "label_en": "Histology"},
            {"kind": "mdt", "label": "MDT", "label_en": "MDT"},
        ],
        "edges": [],
    })
    v = validate(g)
    assert len(v.nodes) >= 5
    histo = next(n for n in g["nodes"] if "histolog" in (n["label"] + n.get("label_en", "")).lower())
    assert histo["completion"] == "evidence"
    assert histo["accepted_formats"] == ["pdf", "docx", "doc"]
    assert all(n.get("description") and n.get("description_en") for n in g["nodes"])


def test_draft_from_llm_steps():
    from backend.pathway.generate import _draft_from_llm, materialize
    g = materialize(_draft_from_llm({
        "steps": [
            {"kind": "start", "label": "Žádost", "label_en": "Referral",
             "description": "Suspected pancreatic head mass.", "description_en": "Suspected pancreatic head mass."},
            {"kind": "document", "label": "CT břicha", "label_en": "Abdominal CT", "formats": ["dcm", "pdf"],
             "description": "CT of the pancreatic head mass.", "description_en": "CT of the pancreatic head mass."},
            {"kind": "mdt", "label": "MDT", "label_en": "MDT"},
        ]
    }))
    validate(g)
    assert any("pancreatic" in (n.get("description_en") or "") for n in g["nodes"])
    ct = next(n for n in g["nodes"] if "CT" in (n.get("label_en") or n["label"]))
    assert "dcm" in (ct.get("accepted_formats") or [])
