"""python scripts/pathway_pancreas_mk2026.py – Build seed/pathways/versions/pancreas-modrakniha-2026.json: the mockup1 pancreas diagnostic pathway (ČOS Modrá
kniha 32, 2026, ch. 7) in the beta graph format, with the resectability outcome confirmed at the MDT."""
import copy, json, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.seed import REPORT, SCAN, standard_tail  # noqa: E402
from backend.pathway.model import validate  # noqa: E402

v1 = {n["id"]: n for n in json.loads((ROOT / "seed/pathways/pancreas.json").read_text())["graph"]["nodes"]}
MK = "ČOS Modrá kniha, 32. vydání (2026), kap. 7 – C25"
MK_EN = "ČOS Blue Book, 32nd edition (2026), ch. 7 – C25"

def keep(nid, **over):
    n = copy.deepcopy(v1[nid])
    n.update(over)
    return n

def ev(nid, label, label_en, owner, sla, desc, desc_en, why, why_en, req=None, blocking=True, formats=REPORT, **kw):
    return {"id": nid, "type": "step", "label": label, "label_en": label_en, "phase": kw.pop("phase", "diagnostics"),
            "owner_role": owner, "sla_days": sla, "completion": "evidence", "requires": req or [{"kind": "described"}],
            "blocking": blocking, "accepted_formats": formats, "description": desc, "description_en": desc_en,
            "why": why, "why_en": why_en, **kw}

nodes = [
    keep("referral"), keep("triage"), keep("prior_reports"),
    ev("bloods", "Odběry – bilirubin, jaterní testy, KO", "Bloods – bilirubin, liver tests, blood count", "coordinator", 3,
       "Bilirubin, jaterní testy, krevní obraz, koagulace a glykemie na začátku cesty – spolu s CT.",
       "Bilirubin, liver tests, blood count, clotting and glucose at the start of the pathway, alongside the CT.",
       "Ikterus a cholestáza mění postup (drenáž) i výklad CA 19-9. Struktura: NHS timed HPB pathway.",
       "Jaundice and cholestasis change the next steps (drainage) and how CA 19-9 is read. Structure: NHS timed HPB pathway.",
       blocking=False),
    keep("ct", label="CT – pankreatický protokol + CT hrudníku", label_en="CT pancreatic protocol + chest CT",
         description="Vícefázové CT břicha v pankreatickém protokolu a CT hrudníku: staging a vztah nádoru k cévám (VP, VMS, truncus coeliacus, AMS, a. hepatica communis).",
         description_en="Multiphase pancreatic-protocol CT of the abdomen plus chest CT: staging and the tumour's relation to the vessels (PV, SMV, coeliac trunk, SMA, common hepatic artery).",
         why=f"{MK}: „Před zahájením onkologické léčby musí být proveden staging onemocnění.“ Resekabilita se definuje vztahem nádoru k cévám.",
         why_en=f"{MK_EN}: staging is mandatory before any oncological treatment; resectability is defined by the tumour's relation to the vessels."),
    keep("biliary", label="Drenáž žlučových cest (ERCP stent) – při ikteru", label_en="Biliary drainage (ERCP stent) – if jaundiced",
         description="Při obstrukčním ikteru drenáž (ERCP stent, příp. PTD) – před interpretací CA 19-9 a před neoadjuvancí.",
         description_en="Drainage for obstructive jaundice (ERCP stent, or PTD) – before CA 19-9 is interpreted and before neoadjuvant treatment.",
         why=f"{MK}: u všech pacientů je nutné zajistit drenáž žlučových cest (podpůrná léčba). Cholestáza falešně zvyšuje CA 19-9.",
         why_en=f"{MK_EN}: biliary drainage is part of the supportive care every patient needs. Cholestasis falsely raises CA 19-9."),
    keep("labs", label="CA 19-9", label_en="CA 19-9",
         description="CA 19-9 – nejlépe po drenáži, při normálním bilirubinu (jinak je hodnota falešně vyšší).",
         description_en="CA 19-9 – ideally after drainage with a normal bilirubin (otherwise the value is falsely high).",
         why=f"{MK}: „zohledněna by měla být i hodnota CA 19-9 a celkový stav pacienta“. CA 19-9 > 500 U/ml je biologické kritérium hraniční resekability (IAP 2017).",
         why_en=f"{MK_EN}: CA 19-9 and the patient's condition must be taken into account. CA 19-9 > 500 U/ml is the biological criterion of borderline resectability (IAP 2017)."),
    ev("performance_status", "Celkový stav (ECOG), komorbidity", "Performance status (ECOG), comorbidities", "koc_doctor", 3,
       "Výkonnostní stav ECOG/PS a komorbidity zapsané lékařem (ambulantní zpráva, epikríza).",
       "ECOG / performance status and comorbidities recorded by a doctor (outpatient report, discharge summary).",
       f"{MK}: o léčbě rozhoduje i celkový stav; paliativní systémová léčba je doporučena při PS 0–2. ECOG ≥ 2 je podmíněné kritérium hraniční resekability (IAP 2017).",
       f"{MK_EN}: the patient's condition is part of the decision; palliative systemic therapy is recommended for PS 0–2. ECOG ≥ 2 is the conditional criterion of borderline resectability (IAP 2017)."),
    {"id": "resectability", "type": "decision", "label": "Resekabilita (radiologické hodnocení)", "label_en": "Resectability (radiological assessment)",
     "phase": "diagnostics", "owner_role": "radiology", "sla_days": 2, "completion": "branch", "action": "Zvolit kategorii",
     "description": "Radiolog / lékař KOC zařadí nález podle CT (vztah k cévám), CA 19-9 a ECOG do jedné ze 4 kategorií. Řídí, která další vyšetření jsou potřeba; MDT kategorii potvrdí nebo změní.",
     "description_en": "The radiologist / KOC doctor classifies the case from the CT (vessel contact), CA 19-9 and ECOG into one of the 4 categories. It decides which further exams are needed; the MDT confirms or changes it.",
     "why": f"{MK}: kapitola je členěna podle kategorií 7.1 resekabilní a hraničně resekabilní, 7.2 lokálně pokročilý, 7.3 metastatický. Anatomická kritéria: NCCN; hraniční resekabilita: IAP 2017.",
     "why_en": f"{MK_EN}: the chapter is organised by 7.1 resectable and borderline, 7.2 locally advanced, 7.3 metastatic. Anatomical criteria: NCCN; borderline: IAP 2017.",
     "branches": [{"key": "resectable", "label": "Resekabilní", "label_en": "Resectable"},
                  {"key": "borderline", "label": "Hraničně resekabilní", "label_en": "Borderline resectable"},
                  {"key": "locally_advanced", "label": "Lokálně pokročilý", "label_en": "Locally advanced"},
                  {"key": "metastatic", "label": "Metastatický", "label_en": "Metastatic"}]},
    ev("staging_laparoscopy", "Stagingová laparoskopie", "Staging laparoscopy", "koc_doctor", 10,
       "U resekabilního / hraničně resekabilního nálezu při nádoru > 3 cm, ascitu nebo CA 19-9 > 500 U/ml bez cholestázy – vyloučení peritoneálního rozsevu.",
       "For resectable / borderline disease with a tumour > 3 cm, ascites or CA 19-9 > 500 U/ml without cholestasis – to rule out peritoneal spread.",
       "Není v kapitole ČOS (strukturní zdroj AWMF S3 2024) – proto není blokující.",
       "Not in the ČOS chapter (structure source: AWMF S3 2024) – so it does not block.", blocking=False),
    keep("mri_liver", description="MR jater s difuzí u potenciálně resekabilního nálezu – vyloučení drobných jaterních metastáz před operací.",
         description_en="Liver MRI with diffusion for potentially resectable disease – to rule out small liver metastases before surgery."),
    keep("pet_ct", label="PET-CT (lokalizované onemocnění)", label_en="PET-CT (localized disease)",
         why="Volitelné u lokalizovaného onemocnění před operací, radioterapií nebo systémovou léčbou (NICE NG85).",
         why_en="Optional for localized disease before surgery, radiotherapy or systemic therapy (NICE NG85)."),
    keep("anticoag"),
    keep("biopsy", label="EUS-FNB (příp. biopsie metastázy)", label_en="EUS-FNB (or biopsy of a metastasis)",
         description="Bioptická verifikace pod EUS, u metastatického onemocnění raději biopsie metastázy (játra).",
         description_en="EUS-guided biopsy; in metastatic disease a biopsy of a metastasis (liver) is preferred.",
         why=f"{MK}: „CHT není možné zahájit bez histologické, ev. cytologické verifikace.“ Po 2 nediagnostických biopsiích lze dle ESMO rozhodnout na MDT. Před primární resekcí není biopsie nutná.",
         why_en=f"{MK_EN}: chemotherapy cannot start without histological or cytological verification. After 2 non-diagnostic biopsies the MDT may decide (ESMO). Not mandatory before upfront resection."),
    keep("histology", why=f"{MK}: histologická / cytologická verifikace je podmínkou systémové léčby (neoadjuvance, indukce, paliace).",
         why_en=f"{MK_EN}: histological / cytological verification is required before systemic therapy (neoadjuvant, induction, palliative)."),
    keep("germline", label="Genetická konzultace (zárodečné BRCA1/2, PALB2)", label_en="Genetic counselling (germline BRCA1/2, PALB2)",
         why=f"{MK}: „vstupní genetická konzultace je indikována u všech pacientů s nově diagnostikovaným karcinomem pankreatu“. Neblokuje MDT.",
         why_en=f"{MK_EN}: genetic counselling is indicated for every patient newly diagnosed with pancreatic cancer. Does not block the MDT."),
    keep("molecular", label="MSI (IHC), NTRK, somatické BRCA1/2 a KRAS, příp. NGS", label_en="MSI (IHC), NTRK, somatic BRCA1/2 and KRAS, NGS if indicated",
         description="U metastatického onemocnění a pacienta schopného cílené léčby; indikace NGS přes molekulární tumor board.",
         description_en="For metastatic disease in a patient fit for targeted therapy; NGS indication via the molecular tumour board.",
         why=f"{MK}: u vybraných pacientů s metastatickým onemocněním únosných cílené terapie MSI, NTRK, somatické BRCA1/2 a KRAS.",
         why_en=f"{MK_EN}: for selected metastatic patients fit for targeted therapy – MSI, NTRK, somatic BRCA1/2 and KRAS."),
    ev("pgx", "Farmakogenetika před chemoterapií (DPYD, UGT1A1)", "Pharmacogenetics before chemotherapy (DPYD, UGT1A1)",
       "koc_doctor", 14,
       "Genotyp DPYD (deficit DPD) před 5-FU / kapecitabinem a UGT1A1*28 před irinotekanem (FOLFIRINOX, NALIRIFOX) – "
       "pro úpravu počáteční dávky. Nemění diagnózu ani kategorii resekability, proto neblokuje MDT; vyplatí se objednat "
       "hned, aby byl výsledek hotový při zahájení léčby. U resekabilních před adjuvancí.",
       "DPYD genotype (DPD deficiency) before 5-FU / capecitabine and UGT1A1*28 before irinotecan (FOLFIRINOX, NALIRIFOX) – "
       "to adjust the starting dose. It changes neither the diagnosis nor the resectability category, so it does not block "
       "the MDT; order it early so the result is ready when treatment starts. For resectable disease before adjuvant therapy.",
       "EMA/PRAC 2020: před léčbou fluoropyrimidiny testovat deficit DPD; dávkování dle genotypu CPIC (DPYD) a DPWG "
       "(DPYD, UGT1A1–irinotekan), shrnuto v ClinPGx. Není v kapitole ČOS 7 – strukturní zdroj, neblokuje.",
       "EMA/PRAC 2020: test for DPD deficiency before fluoropyrimidines; genotype-based dosing per CPIC (DPYD) and DPWG "
       "(DPYD, UGT1A1–irinotecan), summarised in ClinPGx. Not in ČOS chapter 7 – structure source, does not block.",
       blocking=False),
    keep("nutrition", label="Nutriční podpora, pankreatické enzymy, diabetes", label_en="Nutrition, pancreatic enzymes, diabetes",
         why=f"{MK}: podpůrná léčba (nutrice, enzymy, kompenzace diabetu) u všech pacientů; neblokuje MDT.",
         why_en=f"{MK_EN}: supportive care (nutrition, enzymes, diabetes control) for every patient; does not block the MDT."),
    keep("pain"), keep("psycho"),
]

# final states: the MDT confirms one category (auto-done once the MDT is recorded, the other three are skipped)
OUTCOMES = [
    ("resectable", "Resekabilní", "Resectable",
     "Bez kontaktu s arteriemi (truncus coeliacus, AMS, a. hepatica communis); VMS/VP bez kontaktu nebo ≤ 180° bez nepravidelnosti kontury. Bez vzdálených metastáz.",
     "No arterial contact (coeliac trunk, SMA, common hepatic artery); SMV/PV no contact or ≤ 180° without contour irregularity. No distant metastases.",
     "Další postup: primární resekce (u vysokého rizika – CA 19-9 > 500, velký nádor, bolest, hubnutí – zvážit neoadjuvanci), poté adjuvance mFOLFIRINOX.",
     "Next: upfront resection (consider neoadjuvant treatment for high-risk features – CA 19-9 > 500, large tumour, pain, weight loss), then adjuvant mFOLFIRINOX."),
    ("borderline", "Hraničně resekabilní", "Borderline resectable",
     "Anatomicky: VMS/VP > 180° nebo ≤ 180° s nepravidelností / trombózou, rekonstruovatelné; kontakt s a. hepatica communis bez šíření na truncus či bifurkaci; AMS ≤ 180°; (tělo/kauda: truncus ≤ 180°). Biologicky (IAP): CA 19-9 > 500 U/ml nebo uzliny prokázané biopsií/PET. Podmíněně: ECOG ≥ 2.",
     "Anatomical: SMV/PV > 180° or ≤ 180° with irregularity / thrombosis, reconstructible; common hepatic artery contact without extension to the coeliac trunk or bifurcation; SMA ≤ 180°; (body/tail: coeliac trunk ≤ 180°). Biological (IAP): CA 19-9 > 500 U/ml or nodes proven by biopsy/PET. Conditional: ECOG ≥ 2.",
     "Další postup: histologie, neoadjuvantní chemoterapie (mFOLFIRINOX / gemcitabin + nab-paklitaxel), restaging CT + CA 19-9, MDT o resekci.",
     "Next: histology, neoadjuvant chemotherapy (mFOLFIRINOX / gemcitabine + nab-paclitaxel), restaging CT + CA 19-9, MDT on resection."),
    ("locally_advanced", "Lokálně pokročilý", "Locally advanced",
     "Bez vzdálených metastáz, ale AMS nebo truncus coeliacus > 180°, nerekonstruovatelná VMS/VP, kontakt s aortou nebo první jejunální větví AMS.",
     "No distant metastases, but SMA or coeliac trunk > 180°, unreconstructible SMV/PV, contact with the aorta or the first jejunal SMA branch.",
     "Další postup: histologie, indukční chemoterapie, restaging; při odpovědi MDT zvažuje konverzní resekci, jinak (chemo)radioterapie / pokračování léčby.",
     "Next: histology, induction chemotherapy, restaging; with a response the MDT considers conversion surgery, otherwise (chemo)radiotherapy / continued treatment."),
    ("metastatic", "Metastatický", "Metastatic",
     "Vzdálené metastázy (játra, peritoneum, plíce, nonregionální uzliny) nebo maligní ascites / pozitivní cytologie z laváže.",
     "Distant metastases (liver, peritoneum, lungs, non-regional nodes) or malignant ascites / positive peritoneal cytology.",
     "Další postup: histologie (biopsie metastázy), paliativní systémová léčba dle PS (0–2), zárodečné BRCA (udržovací olaparib), MSI / NTRK; podpůrná péče.",
     "Next: histology (biopsy of a metastasis), palliative systemic therapy by PS (0–2), germline BRCA (olaparib maintenance), MSI / NTRK; supportive care."),
]
for key, cs, en, crit, crit_en, nxt, nxt_en in OUTCOMES:
    nodes.append({"id": f"outcome_{key}", "type": "step", "label": f"Závěr: {cs}", "label_en": f"Conclusion: {en}",
                  "phase": "mdt", "owner_role": "mdt", "sla_days": 0, "completion": "auto",
                  "description": f"Konečný stav diagnostické cesty potvrzený MDT. Kritéria: {crit}",
                  "description_en": f"Final state of the diagnostic pathway, confirmed by the MDT. Criteria: {crit_en}",
                  "why": f"{nxt} Zdroje: {MK}; NCCN Pancreatic Adenocarcinoma 2025; IAP 2017; ESMO 2023.",
                  "why_en": f"{nxt_en} Sources: {MK_EN}; NCCN Pancreatic Adenocarcinoma 2025; IAP 2017; ESMO 2023."})

E = lambda s, t, b=None: {"source": s, "target": t, **({"branch": b} if b else {})}
edges = [E("referral", "triage")] + [E("triage", x) for x in
         ("prior_reports", "bloods", "ct", "performance_status", "germline", "nutrition", "pain", "psycho")] + [
    E("bloods", "biliary"), E("bloods", "labs"), E("biliary", "labs"),
    E("ct", "resectability"), E("labs", "resectability"), E("performance_status", "resectability"),
    *[E("resectability", "staging_laparoscopy", b) for b in ("resectable", "borderline")],
    *[E("resectability", "mri_liver", b) for b in ("resectable", "borderline")],
    *[E("resectability", "pet_ct", b) for b in ("resectable", "borderline", "locally_advanced")],
    # biopsy also straight from the decision: without an anticoagulant the anticoag step is skipped
    E("resectability", "anticoag"), E("prior_reports", "anticoag"), E("anticoag", "biopsy"), E("resectability", "biopsy"),
    E("biopsy", "histology"),
    E("resectability", "molecular", "metastatic"), E("histology", "molecular"),
    # systemic therapy comes first in these categories; resectable: before adjuvant therapy (after the MDT)
    *[E("resectability", "pgx", b) for b in ("borderline", "locally_advanced", "metastatic")],
]
tail_n, tail_e = standard_tail(["histology", "staging_laparoscopy", "mri_liver", "pet_ct", "molecular", "germline", "pgx"])
# MDT → final state (gated by the resectability decision) → decision to treat
tail_e = [e for e in tail_e if not (e["source"] == "mdt" and e["target"] == "decision")]
for key, *_ in OUTCOMES:
    tail_e += [E("mdt", f"outcome_{key}"), E("resectability", f"outcome_{key}", key), E(f"outcome_{key}", "decision")]
for n in tail_n:
    if n["id"] == "mdt":
        n["description"] = "MDT potvrdí (nebo změní) kategorii resekability a zapíše diagnózu, závěr a doporučení léčby."
        n["description_en"] = "The MDT confirms (or changes) the resectability category and records the diagnosis, conclusion and treatment advice."
        n["why"] = f"{MK}: na MDT patří všichni pacienti s lokalizovaným karcinomem pankreatu a metastatičtí pacienti, u nichž se předpokládá kombinovaná léčba, NGS nebo multioborový přístup."
        n["why_en"] = f"{MK_EN}: every patient with localized pancreatic cancer, and metastatic patients expected to need combined therapy, NGS or a multidisciplinary approach, goes to the MDT."
graph = {"nodes": nodes + tail_n, "edges": edges + tail_e}
validate(graph)
out = {"code": "pancreas", "version_label": "v.modrakniha.2026", "status": "active",
       "guideline_source": f"{MK} (https://www.linkos.cz/…/32-7-zhoubny-novotvar-slinivky-brisni-c25/), závazný text pro úrovně požadavků. "
                           "Strukturní zdroje: NCCN Pancreatic Adenocarcinoma (kritéria resekability), IAP 2017 (hraniční resekabilita), "
                           "ESMO 2023, AWMF S3 2024 (stagingová laparoskopie), NICE NG85 (PET-CT). Převzato z mockup1 "
                           "(seed/pathways/diagnostic/pancreas.json). SLA dny jsou lokální. Před klinickým použitím musí ověřit lékaři KOC.",
       "graph": graph}
p = ROOT / "seed/pathways/versions/pancreas-modrakniha-2026.json"
p.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
print(p, len(graph["nodes"]), "nodes", len(graph["edges"]), "edges")
