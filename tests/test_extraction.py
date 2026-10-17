"""Rule-based extraction (no Neo4j, no LLM)."""
from datetime import date

from backend.extract.pipeline import extract_document
from backend.ingest.identity import check_identity, rc_info
from backend.ingest.reader import read_document

from .conftest import PACIENT


def x(name):
    return extract_document(read_document(PACIENT / name), use_llm=False)


def test_doc_types_and_dates():
    expected = {
        "01": ("specialist_report", date(2026, 7, 20)), "02": ("lab", date(2026, 9, 1)), "03": ("imaging", date(2026, 9, 3)),
        "04": ("gp_summary", date(2026, 9, 4)), "05": ("specialist_report", date(2026, 9, 15)),
        "06": ("imaging", date(2026, 9, 29)), "07": ("referral", date(2026, 10, 2)), "08": ("imaging", date(2026, 10, 8)),
        "09": ("procedure", date(2026, 10, 12)), "10": ("lab", date(2026, 10, 15)), "11": ("histology", date(2026, 10, 19)),
        "12": ("pain_report", date(2026, 10, 26)), "13": ("psychology_report", date(2026, 10, 27)),
    }
    for f in sorted(PACIENT.glob("[0-9]*.docx")):
        r = x(f.name)
        assert (r.doc_type, r.doc_date) == expected[f.name[:2]], f.name


def test_tumour_markers():
    labs = {f.props["analyte"]: f.props for f in x("10_Laborator_KOC2_2026-10-15.docx").facts if f.kind == "lab"}
    assert labs["CA 19-9"]["value_num"] == 312 and labs["CA 19-9"]["flag"] == "H" and labs["CA 19-9"]["is_tumor_marker"]
    assert labs["CEA"]["flag"] is None


def test_histology_and_ct():
    h = next(f for f in x("11_Histologie_KOC2_2026-10-19.docx").facts if f.kind == "diagnosis")
    assert h.props["status"] == "confirmed" and h.props["grade"] == "G2–G3" and h.props["morphology"] == "8500/3"
    assert "duktální adenokarcinom" in h.props["name"].lower()
    ct = next(f for f in x("08_CT_KOC1_2026-10-08.docx").facts if f.kind == "exam")
    assert "35 mm" in ct.props["conclusion"] and ct.props.get("protocol") == "pancreatic"


def test_referral_lists_prior_exams():
    mentioned = [f.props for f in x("07_PL_zadost_KOC2_2026-10-02.docx").facts if f.kind == "mentioned_exam"]
    assert {m["date"] for m in mentioned} == {date(2026, 9, 1), date(2026, 9, 3), date(2026, 9, 15), date(2026, 9, 29),
                                              date(2026, 7, 20)}


def test_impossible_dates_are_flagged():
    f9 = x("09_Biopsie_vykon_KOC2_2026-10-12.docx").flags
    f11 = x("11_Histologie_KOC2_2026-10-19.docx").flags
    assert len(f9) == 1 and f9[0]["found_date"] == date(2026, 10, 18)
    assert len(f11) == 1 and f11[0]["found_date"] == date(2026, 10, 20)
    # no false alarms elsewhere (e.g. culture issued 3 days after sampling is normal)
    for f in sorted(PACIENT.glob("[0-9]*.docx")):
        if f.name[:2] not in ("09", "11"):
            assert not x(f.name).flags, f.name


def test_rc_and_identity():
    assert rc_info("635722/1013") == {"dob": date(1963, 7, 22), "sex": "F"}
    header = {"rc": "635722/1013", "patient_name": "Alena Procházková", "dob": date(1963, 7, 22)}
    assert check_identity(header, "635722/1013", "Alena Procházková", date(1963, 7, 22))["ok"]
    wrong = {**header, "rc": "635723/1014"}
    res = check_identity(wrong, "635722/1013", "Alena Procházková", date(1963, 7, 22))
    assert not res["ok"] and any("RČ" in i for i in res["issues"])


def test_node_formats_and_described_match():
    from backend.extract.match_nodes import match_document
    from backend.pathway.formats import format_ok
    from backend.pathway.model import BLANK_GRAPH, validate

    assert format_ok(["pdf", "docx"], "zprava.pdf")
    assert format_ok(["dicom"], "scan.dcm")
    assert not format_ok(["dicom"], "letter.docx")
    assert format_ok(["any"], "film.tiff")
    validate(BLANK_GRAPH)

    ct = {"id": "ct", "completion": "evidence", "label": "CT hrudníku", "label_en": "CT scan",
          "description": "Chest CT report", "accepted_formats": ["dicom", "pdf"],
          "requires": [{"kind": "exam", "exam_type": "ct"}]}
    hits = match_document([ct], doc_type="imaging", exam_type="ct", filename="ct_hrudniku.pdf",
                          title="CT hrudníku", excerpt="Závěr: CT hrudníku bez uzlin.")
    assert hits and hits[0].props["node_id"] == "ct"
    miss = match_document([ct], doc_type="referral", exam_type=None, filename="zadost.docx",
                          title="Žádost o převzetí", excerpt="Žádost o převzetí do KOC.")
    assert not miss
