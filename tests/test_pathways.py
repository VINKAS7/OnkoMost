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
