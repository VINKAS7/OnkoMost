"""IRIS / FHIR storage helpers that need no running server: the JSON codec of the globals, the FHIR identity
mapping, identifier masking and keyword ranking of the GraphRAG chunks."""
from datetime import date

from backend.fhir.records import _identity, _patient_resource
from backend.graph.store import GraphStore, _dump, _load
from backend.rag.index import _bm25, _prepare, redact, stem


def test_globals_json_keeps_dates():
    v = {"date": date(2026, 10, 1), "items": ["a", 1], "nested": {"dob": date(1963, 7, 22)}}
    assert _load(_dump(v)) == v


def test_patient_identity_round_trip():
    p = {"patient_name": "Alena Procházková", "rc": "635722/1013", "dob": date(1963, 7, 22), "sex": "F",
         "address": "Lipová 12, Dolní Břežany", "phone": "+420 602 123 456", "insurer": "111"}
    res = _patient_resource("5f0c…", p)
    assert res["name"][0]["family"] == "Procházková" and res["name"][0]["given"] == ["Alena"]
    assert res["gender"] == "female" and res["birthDate"] == "1963-07-22"
    back = _identity(res)
    assert {k: back[k] for k in p} == p


def test_merged_fact_keeps_icd_and_best_name():
    node = {"name": "Arteriální hypertenze", "kind": "condition"}
    GraphStore._merge(node, {"name": "Hypertenze", "icd10": "I10"})
    assert node == {"name": "Hypertenze", "kind": "condition", "icd10": "I10", "icd10_from_name": True}
    GraphStore._merge(node, {"name": "Esenciální arteriální hypertenze", "icd10": "I10"})
    assert node["name"] == "Hypertenze"  # the shorter name stays once the code came with a name


def test_redact_masks_identifiers_only():
    text = "Pacientka: Alena Procházková, RČ 635722 / 1013, tel. +420 602 123 456. CA 19-9 312 kU/l."
    out = redact(text, ["Alena Procházková", "635722/1013", "+420 602 123 456", "Alena", "Procházková"])
    assert "Procházková" not in out and "635722" not in out and "602" not in out
    assert "CA 19-9 312 kU/l" in out


def test_keyword_ranking_stems_and_phrases():
    rows = [{"id": "1", "text": "Histologie: duktální adenokarcinom pankreatu, G2-G3."},
            {"id": "2", "text": "Laboratoř: CA 19-9 312 kU/l, CEA 4,1."},
            {"id": "3", "text": "Kardiologie: hypertenze, apixaban 5 mg."}]
    hits = [r["id"] for _, r in _bm25(["CA 19-9"], rows)]
    assert hits == ["2"]
    assert [r["id"] for _, r in _bm25(["histologické"], rows)] == ["1"]  # inflected form, same stem
    assert not _bm25(["tramadol"], rows)
    assert stem("pankreatu") == stem("pankreatem")


def test_embedding_prefixes_follow_the_model():
    q = _prepare("What did the histology show?", "query", "qwen3-embedding:0.6b")
    assert q.startswith("Instruct: ") and q.endswith("\nQuery:What did the histology show?")
    assert _prepare("Bioptický nález", "passage", "qwen3-embedding:0.6b") == "Bioptický nález"
    assert _prepare("CA 19-9", "query", "intfloat/multilingual-e5-small") == "query: CA 19-9"
    assert _prepare("CA 19-9", "passage", "bge-m3") == "CA 19-9"
