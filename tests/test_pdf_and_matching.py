"""PDF reports (read by Docling) and the LLM step matcher (offline: PDFs are generated, the LLM is stubbed)."""
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import pytest  # noqa: E402

from backend.extract import match_nodes  # noqa: E402
from backend.extract.schemas import DocumentSteps, StepMatch  # noqa: E402
from backend.ingest.classify import classify  # noqa: E402
from backend.ingest.reader import read_document  # noqa: E402

CT_REPORT = ["Výsledek vyšetření – CT hrudníku s k. l.", "Pacient: Josef Král, RČ 550814/1023, ZP 111",
             "Datum vyšetření: 10. 9. 2026", "POPIS", "V pravém horním laloku lobulovaný uzel 15 × 13 mm.",
             "ZÁVĚR", "Uzel pravého horního laloku 15 mm suspektní z malignity.", "MUDr. Eva Šimková"]


def _pdf(path, lines):
    plt.rcParams["pdf.fonttype"] = 42  # real text (TrueType), like a PDF exported from a hospital system
    fig = plt.figure(figsize=(8.27, 11.69))
    for i, line in enumerate(lines):
        fig.text(0.06, 0.95 - i * 0.03, line, fontsize=9)
    fig.savefig(path, format="pdf")
    plt.close(fig)


def test_pdf_report_reads_like_a_docx(tmp_path):
    path = tmp_path / "03_CT_hrudniku.pdf"
    _pdf(path, CT_REPORT)
    doc = read_document(path)
    assert doc.header.get("rc") == "550814/1023" and doc.header.get("patient_name") == "Josef Král"
    assert "ZÁVĚR" in doc.sections and "15 mm" in doc.sections["ZÁVĚR"]
    assert classify(doc)[:2] == ("imaging", "ct")


def test_empty_pdf_is_refused(tmp_path):
    path = tmp_path / "empty.pdf"
    _pdf(path, [])
    with pytest.raises(ValueError, match="read any text"):
        read_document(path)


def test_scanned_report_is_read_through_ocr(tmp_path):
    """A photo / scan of the paper report: no text layer, only pixels – Docling's OCR (Czech) reads it."""
    png = tmp_path / "page.png"
    plt.rcParams["pdf.fonttype"] = 42
    fig = plt.figure(figsize=(8.27, 4))
    for i, line in enumerate(CT_REPORT):
        fig.text(0.05, 0.92 - i * 0.11, line, fontsize=14)
    fig.savefig(png, dpi=200)
    plt.close(fig)
    from PIL import Image
    scan = tmp_path / "sken.pdf"
    Image.open(png).convert("RGB").save(scan)  # an image-only PDF, like a scanner makes
    doc = read_document(scan)
    assert "550814/1023" in doc.full_text and "15 mm" in doc.full_text


NODES = [
    {"id": "referral", "completion": "evidence", "label": "Žádost", "requires": [{"kind": "document", "doc_type": "referral"}]},
    {"id": "prior", "completion": "evidence", "label": "Předchozí zprávy", "requires": [{"kind": "mentioned_exams_received"}]},
    {"id": "ct", "completion": "evidence", "label": "CT hrudníku", "description": "CT report",
     "requires": [{"kind": "exam", "exam_type": "ct"}], "accepted_formats": ["pdf", "docx"]},
    {"id": "biomarkers", "completion": "evidence", "label": "Biomarkery", "description": "PD-L1, EGFR, ALK",
     "requires": [{"kind": "described"}], "accepted_formats": ["pdf", "docx"]},
    {"id": "pft", "completion": "evidence", "label": "Funkce plic", "description": "spirometrie",
     "requires": [{"kind": "described"}], "accepted_formats": ["docx"]},  # a PDF is not accepted here
    {"id": "triage", "completion": "manual", "label": "Triáž"},
]
TEXT = "Histologie: adenokarcinom. PD-L1 pozitivní v 75 % nádorových buněk (TPS 75 %)."


def test_llm_matches_need_a_real_quote_and_a_known_step(monkeypatch):
    seen = {}

    def fake(schema, instruction, text, max_tokens=0):
        seen["text"] = text
        assert schema is DocumentSteps
        return DocumentSteps(steps=[StepMatch(step_id="biomarkers", quote="PD-L1 pozitivní v 75 %"),
                                    StepMatch(step_id="ct", quote="CT hrudníku ukazuje uzel"),  # not in the text
                                    StepMatch(step_id="mri", quote="adenokarcinom")])           # not a step
    monkeypatch.setattr(match_nodes.llm, "extract", fake)
    facts = match_nodes.match_document(NODES, doc_type="histology", exam_type="histology", filename="hist.pdf",
                                       title="Bioptický nález", excerpt=TEXT)
    assert [(f.key, f.method) for f in facts] == [("biomarkers", "llm")]
    # one call per document, with every step it could fulfil – not the prior-reports, manual or PDF-refusing steps
    assert "STEP ct:" in seen["text"] and "STEP biomarkers:" in seen["text"]
    assert "STEP prior:" not in seen["text"] and "STEP triage:" not in seen["text"] and "STEP pft:" not in seen["text"]


def test_a_letter_that_only_reports_an_exam_is_not_offered_for_that_exam(monkeypatch):
    seen = {}

    def fake(schema, instruction, text, max_tokens=0):
        seen["text"] = text
        return DocumentSteps(steps=[StepMatch(step_id="ct", quote="uzel 15 mm")])  # the model says yes anyway
    monkeypatch.setattr(match_nodes.llm, "extract", fake)
    facts, _ = match_nodes.match(NODES, doc_type="referral", exam_type=None, filename="zadost.pdf", title="Žádost",
                                 excerpt="CT hrudníku (10. 9. 2026): uzel 15 mm.", reported={"ct"})
    assert "STEP ct:" not in seen["text"] and not [f for f in facts if f.key == "ct"]


def test_rule_and_llm_matches_combine(monkeypatch):
    monkeypatch.setattr(match_nodes.llm, "extract", lambda *a, **k: DocumentSteps(
        steps=[StepMatch(step_id="ct", quote="uzel 15 × 13 mm")]))
    facts = match_nodes.match_document(NODES, doc_type="imaging", exam_type="ct", filename="ct.pdf", title="CT",
                                       excerpt="V pravém horním laloku lobulovaný uzel 15 × 13 mm.")
    assert [(f.key, f.method) for f in facts] == [("ct", "rule")]  # the rule already had it: not counted twice
