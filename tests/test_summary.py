"""MDT summary (offline): lab helpers and the three renderers (Word, HTML for the clipboard, plain text)."""
import io
from datetime import date

import docx

from backend.reports import summary as sm


def test_reference_ranges_and_flags():
    assert sm.parse_ref("0,58–1,75") == (0.58, 1.75)
    assert sm.parse_ref("< 37") == (None, 37.0)
    assert sm.parse_ref("> 1,0") == (1.0, None)
    assert sm.parse_ref("neg.") == (None, None)
    t = sm.L["en"]
    assert sm._flag(t, "H") == "↑ high" and sm._flag(t, "++") == "↑ high" and sm._flag(t, "L") == "↓ low"
    assert sm._flag(t, None) == ""


def test_lab_series_keeps_blood_and_urine_apart_and_orders_by_date():
    lab = lambda d, a, v, n, unit, flag=None: {"props": {  # noqa: E731
        "date": d, "analyte": a, "value": v, "value_num": n, "unit": unit, "ref": "0–5", "flag": flag}}
    series = {(s["analyte"], s["unit"]): s for s in sm.lab_series([
        lab(date(2026, 10, 15), "Leukocyty", "8,9", 8.9, "10⁹/l"), lab(date(2026, 9, 1), "Leukocyty", "12,8", 12.8, "10⁹/l", "H"),
        lab(date(2026, 9, 1), "Leukocyty", "65", 65.0, "/µl", "H"), lab(date(2026, 9, 1), "Leukocyty", "65", 65.0, "/µl", "H"),
    ])}
    blood = series[("Leukocyty", "10⁹/l")]
    assert [p["text"] for p in blood["pts"]] == ["12,8", "8,9"] and blood["hi"] == 5.0
    assert len(series[("Leukocyty", "/µl")]["pts"]) == 1  # the same value stated twice is one point


def test_document_categories_match_the_timeline():
    assert [sm.category(t) for t in ("referral", "gp_summary", "imaging", "histology", "procedure", "pain_report", "x")] == \
        ["referral", "referral", "imaging", "pathology", "pathology", "specialist", "other"]


def test_renderers_say_the_same():
    chart = sm.lab_chart([{"analyte": "CA 19-9", "unit": "kU/l", "ref": "< 37", "lo": None, "hi": 37.0, "marker": True,
                           "pts": [{"date": date(2026, 10, 15), "value": 312.0, "text": "312", "flag": "H"}]}], "cs")
    assert chart.startswith(b"\x89PNG")
    s = {"title": "Souhrn pacienta pro MDT", "subtitle": "Alena · KOC", "meta": "Vygenerováno", "lang": "cs", "blocks": [
        ("h", "Nádorové onemocnění"), ("kv", [("Diagnóza", "Duktální adenokarcinom"), ("Poznámky", "")]),
        ("table", ["Krok", "Stav"], [("CT", "doloženo"), ("MR jater", "chybí")], {"widths": [12, 5], "shade": {1: (1, "FBE4E4")}}),
        ("list", ["Chybí údaj: ECOG"]), ("img", chart, "Vývoj laboratoře")]}
    text = sm.to_text(s)
    assert "Diagnóza: Duktální adenokarcinom" in text and "MR jater | chybí" in text and "- Chybí údaj: ECOG" in text
    html = sm.to_html(s)
    assert "<table" in html and "background:#FBE4E4" in html and "data:image/png;base64," in html
    d = docx.Document(io.BytesIO(sm.to_docx(s)))
    cells = [c.text for t in d.tables for r in t.rows for c in r.cells]
    assert "Duktální adenokarcinom" in cells and "chybí" in cells
    assert len(d.inline_shapes) == 1  # the chart is embedded
