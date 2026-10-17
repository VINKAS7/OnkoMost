"""Body map: the deterministic checks around the LLM's organ findings (no IRIS or LLM needed)."""
from backend.reports.bodymap import BodySite, check_site, merge, organs_named, sex_from_rc

CT = ("Tumor hlavy pankreatu 35 mm s venózním postižením VMS. Peripankreatická uzlina 12 × 9 mm, suspektní. "
      "Kontakt tumoru s a. mesenterica superior do 150° obvodu, bez zúžení lumen. Játra bez ložiskových změn. "
      "Bez známek vzdálených metastáz.")
HISTOLOGY = ("Invazivní karcinom levého prsu NST, G2. ER 90 %, PR 70 %, HER2 negativní, Ki-67 25 %. "
             "Uzlina levé axily: metastáza karcinomu. Pravý prs bez ložiskových změn.")


def found(organ, status, quote, source=CT):
    return [(f["organ"], f["status"], f["side"]) for f in check_site(BodySite(organ=organ, status=status, quote=quote), source)]


def test_quote_must_be_in_the_report():
    assert found("pancreas", "primary", "Tumor hlavy pankreatu 40 mm") == []


def test_text_decides_organ_and_status():
    # the model filed the liver finding under the pancreas
    assert found("pancreas", "negative", "Játra bez ložiskových změn.") == [("liver", "negative", None)]
    # a node next to the pancreas is a lymph node
    assert ("lymph_node", "suspicious", None) in found("pancreas", "suspicious", "Peripankreatická uzlina 12 × 9 mm, suspektní.")
    # one sentence, two organs: the tumour is in the pancreas, the vessel is involved
    both = found("pancreas", "primary", "Tumor hlavy pankreatu 35 mm s venózním postižením VMS.")
    assert ("pancreas", "primary", None) in both and ("blood_vessel", "involved", None) in both
    # "bez zúžení" does not cancel the contact with the tumour
    assert found("blood_vessel", "involved", "Kontakt tumoru s a. mesenterica superior do 150° obvodu, bez zúžení lumen.") == [
        ("blood_vessel", "involved", None)]
    # no organ named → nothing
    assert found("liver", "negative", "Bez známek vzdálených metastáz.") == []
    assert organs_named("kontakt tumoru s a. mesenterica superior") == ["blood_vessel"]


def test_histology_is_not_negative_because_of_her2():
    # the LLM called the whole conclusion "negative" (and the breast "prostate")
    got = found("prostate", "negative", HISTOLOGY, HISTOLOGY)
    assert ("breast", "primary", "left") in got
    assert ("lymph_node", "involved", "left") in got
    assert ("breast", "negative", "right") in got


def ev(organ, status, doc_id=1, side=None):
    return {"organ": organ, "status": status, "side": side, "quote": "q", "match": "exact", "doc_id": doc_id,
            "title": "t", "date": "2026-10-08"}


def test_merge_severity_conflict_and_fallback():
    sites = {s["organ"]: s for s in merge([ev("liver", "negative"), ev("liver", "metastasis", 2),
                                           ev("lymph_node", "suspicious"), ev("lymph_node", "negative"),
                                           ev("kidney", "primary")], "colorectal")}
    assert sites["liver"]["status"] == "metastasis" and sites["liver"]["conflict"]
    assert not sites["lymph_node"]["conflict"]  # different node stations may differ
    assert sites["kidney"]["status"] == "suspicious"  # a "primary" outside the pathway organ is not trusted
    assert sites["colon"]["status"] == "primary" and sites["colon"]["from_pathway"]  # no report named it
    assert sites["colon"]["uberon"][0] == "UBERON_0001155"
    breast = {s["organ"]: s for s in merge([ev("breast", "primary", side="left"), ev("breast", "negative", side="right")], "breast")}
    assert breast["breast"]["side"] == "left" and not breast["breast"]["conflict"]
    lung = {s["organ"]: s for s in merge([ev("lung", "primary")], "lung")}
    assert not lung["lung"]["from_pathway"] and "bronchus" not in lung


def test_sex_from_birth_number():
    assert sex_from_rc("635722/1013") == "female"
    assert sex_from_rc("620314/1234") == "male"
    assert sex_from_rc("") is None


def test_two_negations_in_one_sentence():
    text = "Mozek bez ložiskových změn, bez metastáz."
    assert found("brain", "metastasis", text, text) == [("brain", "negative", None)]
