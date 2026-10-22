"""The seeded ESMO pathways (offline): every step explains itself, and the conditional skips work."""
from datetime import date

from backend.pathway.conformance import Ctx, should_skip
from backend.pathway.model import Node
from backend.seed import load_pathways


def test_seed_pathways_are_complete():
    pws = {p["code"]: p for p in load_pathways()}
    assert set(pws) == {"lung", "pancreas", "breast"}
    for code, pw in pws.items():
        assert "ESMO" in pw["guideline_source"]
        for n in pw["graph"]["nodes"]:
            where = f"{code}/{n['id']}"
            assert n["label"] and n.get("label_en"), where
            # the description is the LLM's brief for matching documents; "why" is the guideline reason
            assert n.get("description") and n.get("description_en"), where
            assert n.get("why") and n.get("why_en"), where
            if n.get("completion") == "evidence":
                assert n.get("accepted_formats") and n.get("requires"), where


class _Snap:
    def __init__(self, diagnosis: str):
        self.diagnosis = diagnosis

    def edges(self, kind, cutoff):
        return [({"name": self.diagnosis, "status": "confirmed"}, {}, {})] if kind == "diagnosis" else []


def _ctx(diagnosis: str) -> Ctx:
    ctx = Ctx("patient", date(2026, 10, 20), date(2026, 10, 1))
    ctx._snap = _Snap(diagnosis)
    return ctx


def test_lung_biomarkers_skipped_only_for_small_cell():
    lung = next(p for p in load_pathways() if p["code"] == "lung")
    node = Node.model_validate(next(n for n in lung["graph"]["nodes"] if n["id"] == "biomarkers"))
    assert should_skip(node, _ctx("Malobuněčný karcinom plic"))
    assert should_skip(node, _ctx("Small-cell lung carcinoma"))
    assert not should_skip(node, _ctx("Nemalobuněčný karcinom plic – adenokarcinom"))  # contains "malobuněčn"
    assert not should_skip(node, _ctx("Adenokarcinom plíce, acinární typ"))
    assert not should_skip(node, _ctx(""))


class _ReferralOnly:
    """A patient graph holding only the referral letter (no medication, so no anticoagulant)."""
    flags, facts, docs = {}, {}, {}

    def edges(self, kind=None, cutoff=None, allow_undated=False):
        return []

    def documents(self, cutoff=None, allow_undated=True):
        return [{"uid": "ref", "sqlite_id": 1, "type": "referral", "date": date(2026, 10, 1), "title": "Žádost"}]


def _evaluate(code: str, **ctx_kw):
    from backend.pathway.conformance import evaluate
    from backend.pathway.model import validate
    ctx = Ctx("patient", date(2026, 10, 20), date(2026, 10, 1), events={"triage": date(2026, 10, 2)}, **ctx_kw)
    ctx._snap = _ReferralOnly()
    pg = validate(next(p for p in load_pathways() if p["code"] == code)["graph"])
    return pg, evaluate(pg, ctx)


def test_a_step_this_patient_does_not_need_does_not_skip_the_steps_after_it():
    _, r = _evaluate("pancreas")
    n = r["nodes"]
    assert n["anticoag"]["doc_status"] == "skipped"  # no anticoagulant to stop
    assert n["biopsy"]["status"] == "available" and n["histology"]["doc_status"] == "missing"


def test_a_branch_not_chosen_still_closes_its_steps():
    _, r = _evaluate("lung", decisions={"extent": {"keys": ["metastatic"], "on": date(2026, 10, 5)}})
    assert all(r["nodes"][k]["doc_status"] == "skipped" for k in ("pet_ct", "pft", "mediastinal"))


def test_waived_documents_complete_the_case_but_stay_visible():
    pg, before = _evaluate("pancreas")
    assert not before["pre_mdt_complete"]
    missing = [n.id for n in pg.nodes if n.completion == "evidence" and n.blocking and n.type != "start"
               and n.phase in ("intake", "diagnostics") and before["nodes"][n.id]["doc_status"] == "missing"]
    assert "ct" in missing and "histology" in missing
    _, after = _evaluate("pancreas", waived={nid: date(2026, 10, 15) for nid in missing})
    assert after["pre_mdt_complete"]
    assert all(after["nodes"][nid]["doc_status"] == "waived" for nid in missing)  # never shown as "have"
    assert after["doc_counts"]["waived"] == len(missing)
    assert after["doc_counts"]["have"] == before["doc_counts"]["have"]  # waiving adds nothing to what we have
    assert after["nodes"]["handover"]["status"] == "available"  # the case goes on to the handover and the MDT
    assert not [f for f in after["findings"] if f["kind"] == "to_schedule" and f["node_id"] in missing]


def test_a_document_step_cannot_be_saved_without_a_description():
    import copy

    import pytest

    from backend.pathway.model import validate
    graph = next(p for p in load_pathways() if p["code"] == "pancreas")["graph"]
    validate(graph, editing=True)
    draft = copy.deepcopy(graph)
    pet = next(n for n in draft["nodes"] if n["id"] == "pet_ct")
    pet["description"] = pet["description_en"] = ""
    with pytest.raises(ValueError, match="needs a description"):
        validate(draft, editing=True)
    validate(draft)  # a running case keeps its stored pathway version
