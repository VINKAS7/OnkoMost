"""Body map for the MDT panel: which organs the patient's reports describe as affected by the cancer.

1. Read     – every report dated on/before the MDT date (the same cut-off as the brief and GraphRAG); labs,
              pain and psychology reports are skipped, they never place a tumour.
2. Extract  – the LLM lists organs per report section, from a fixed organ list (so every answer maps to an
              anatomogram UBERON id), with a status and a verbatim Czech quote.
3. Verify   – a site is kept only if its quote occurs in the report (`verify.quote_match`). A "negative" site must
              read as negative ("bez", "negativní", …) and a positive site that reads as negative is turned around.
4. Merge    – one entry per organ, the most severe status wins, all evidence is kept; positive and negative
              evidence for the same organ is flagged as a conflict for the MDT to check.
5. Fallback – the organ of the case's pathway (lung, pancreas, colon, breast) is always shown as the primary site,
              marked "from the referral diagnosis" when no report states it.

LLM calls are cached on disk (storage/llm_cache), so re-running is instant and only new reports cost time.
The result is stored in storage/bodymap/<case_id>.json together with the documents it was computed from.
"""
from __future__ import annotations

import hashlib
import json
import logging
import re
import threading
from datetime import date
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field

from backend.config import ROOT, settings
from backend.extract import llm
from backend.extract.verify import quote_match
from backend.ingest.reader import fold, read_document

log = logging.getLogger(__name__)
STORE = ROOT / "storage" / "bodymap"
STORE.mkdir(parents=True, exist_ok=True)

# key → (UBERON ids in the anatomogram, Czech label, English label). Some organs only exist in one of the
# anatomogram's figures; bone has a different id in the male SVG.
ORGANS: dict[str, tuple[list[str], str, str]] = {
    "lung": (["UBERON_0002048"], "Plíce", "Lung"),
    "bronchus": (["UBERON_0002185"], "Průdušky", "Bronchus"),
    "trachea": (["UBERON_0003126"], "Průdušnice", "Trachea"),
    "pleura": (["UBERON_0000977"], "Pohrudnice", "Pleura"),
    "lymph_node": (["UBERON_0000029"], "Lymfatické uzliny", "Lymph nodes"),
    "liver": (["UBERON_0002107"], "Játra", "Liver"),
    "pancreas": (["UBERON_0001264"], "Slinivka břišní", "Pancreas"),
    "gallbladder": (["UBERON_0002110"], "Žlučník a žlučové cesty", "Gallbladder and bile ducts"),
    "duodenum": (["UBERON_0002114"], "Dvanáctník", "Duodenum"),
    "stomach": (["UBERON_0000945"], "Žaludek", "Stomach"),
    "esophagus": (["UBERON_0001043"], "Jícen", "Oesophagus"),
    "small_intestine": (["UBERON_0002108"], "Tenké střevo", "Small intestine"),
    "colon": (["UBERON_0001155", "UBERON_0001153"], "Tlusté střevo", "Colon"),
    "rectum": (["UBERON_0001052"], "Konečník", "Rectum"),
    "spleen": (["UBERON_0002106"], "Slezina", "Spleen"),
    "kidney": (["UBERON_0002113"], "Ledviny", "Kidney"),
    "adrenal_gland": (["UBERON_0002369"], "Nadledviny", "Adrenal glands"),
    "bladder": (["UBERON_0001255"], "Močový měchýř", "Bladder"),
    "brain": (["UBERON_0000955"], "Mozek", "Brain"),
    "bone": (["UBERON_0002481", "UBERON_00024818"], "Kosti", "Bone"),
    "bone_marrow": (["UBERON_0002371"], "Kostní dřeň", "Bone marrow"),
    "breast": (["UBERON_0000310"], "Prs", "Breast"),
    "ovary": (["UBERON_0000992"], "Vaječníky", "Ovaries"),
    "uterus": (["UBERON_0000995"], "Děloha", "Uterus"),
    "prostate": (["UBERON_0002367"], "Prostata", "Prostate"),
    "thyroid": (["UBERON_0002046"], "Štítná žláza", "Thyroid"),
    "diaphragm": (["UBERON_0001103"], "Bránice", "Diaphragm"),
    "skin": (["UBERON_0000014"], "Kůže", "Skin"),
    "blood_vessel": (["UBERON_0001637"], "Cévy", "Blood vessels"),
}
OrganKey = Literal[
    "lung", "bronchus", "trachea", "pleura", "lymph_node", "liver", "pancreas", "gallbladder", "duodenum", "stomach",
    "esophagus", "small_intestine", "colon", "rectum", "spleen", "kidney", "adrenal_gland", "bladder", "brain", "bone",
    "bone_marrow", "breast", "ovary", "uterus", "prostate", "thyroid", "diaphragm", "skin", "blood_vessel",
]

# Organs a pathway's primary tumour may sit in; the first one is the fallback when no report names it.
PRIMARY = {
    "lung": ["lung", "bronchus"],
    "pancreas": ["pancreas"],
    "colorectal": ["colon", "rectum"],
    "breast": ["breast"],
}
SEVERITY = ["negative", "suspicious", "involved", "metastasis", "primary"]
SKIP_TYPES = {"lab", "pain_report", "psychology_report", "mdt_conclusion", "image_series"}  # no organ text in these
NEGATIVE = re.compile(r"\bbez\b|negativ|nebyl|neprokaz|nenalez|neni\b|nejsou\b|zadn|vylouc|nezvetsen|fyziologick|"
                      r"primeren|klidn|norm[a-z]* nalez", re.I)
CHUNK = 3000
# Word stems (folded: lowercase, no diacritics) that name each organ. A small model often files a finding under the
# wrong organ, so the quote itself decides: it must name the organ, otherwise the finding moves to the organ it names.
ORGAN_WORDS: dict[str, str] = {
    "lung": r"\bplic|\bpulmo",
    "bronchus": r"\bbronch",
    "trachea": r"\btrache|\bprudusnic",
    "pleura": r"\bpleur|\bpohrudnic|fluidothorax",
    "lymph_node": r"\buzlin|\blymf|\bnodal",
    "liver": r"\bjater|\bjatr|\bhepat",
    "pancreas": r"pankrea|\bslinivk",
    "gallbladder": r"\bzlucn|\bzlucov|choledoch|\bbiliar",
    "duodenum": r"\bduoden|\bdvanactnik",
    "stomach": r"\bzalud|\bgastr(?!oent)",
    "esophagus": r"\bjicen|\bezofag",
    "small_intestine": r"tenke strev|\bileum|\bjejun",
    "colon": r"\bkolon|\bcolon|tlust[eo] strev|\bsigm|\bcek|\bcaek|\bcolic",
    "rectum": r"\brekt|\brect|\bkonecnik",
    "spleen": r"\bslezin|\bsplen",
    "kidney": r"\bledvin|\brenal",
    "adrenal_gland": r"\bnadledvin|\badrenal",
    "bladder": r"mocov\w* mechyr|\bmechyr",
    "brain": r"\bmozk|\bmozek|\bcerebr|intrakran",
    "bone": r"\bskelet|\bkost(?!ni dren)|\bobratl|\bosteo|\bossal",
    "bone_marrow": r"kostni dren",
    "breast": r"\bprs[uy]?\b|\bprsni|\bmamm",
    "ovary": r"\bovari|\bvajecnik",
    "uterus": r"\bdeloh|\buter",
    "prostate": r"\bprostat",
    "thyroid": r"\bstitn|\bthyr",
    "diaphragm": r"\bbranic",
    "skin": r"\bkuz[ei]|\bkozn",
    "blood_vessel": r"\bcev|\btepn|\bzil[ay]?\b|\barteri|\bvena\b|\bvenoz|mesenteric|\bportae|portomezenter|\btruncus|"
                    r"\baort|\b[av]\. ?[a-z]",
}


class BodySite(BaseModel):
    organ: OrganKey = Field(description="Organ key from the allowed list")
    side: Literal["left", "right", "both"] | None = Field(default=None, description="Side if written, else null")
    status: Literal["primary", "metastasis", "involved", "suspicious", "negative"]
    quote: str = Field(description="Exact Czech substring of the input that states this finding")


class BodySites(BaseModel):
    sites: list[BodySite] = Field(default_factory=list)


INSTRUCTION = """List the organs and body areas this report describes in relation to the patient's cancer.
status:
- primary: the organ where the primary tumour / carcinoma is.
- metastasis: a metastasis or distant spread (meta, metastáza, generalizace) in that organ.
- involved: lymph nodes or neighbouring structures infiltrated or touched by the tumour (infiltrace, prorůstání,
  kontakt nádoru, postižení uzlin, pozitivní uzliny).
- suspicious: a lesion or node described as suspect or unclear (suspektní, nejasné ložisko, susp.).
- negative: the report explicitly says the organ is without tumour or metastases (bez ložisek, bez metastáz,
  negativní, přiměřený nález).
Only list organs with such a finding; skip organs that are just named. organ must be one of the allowed keys.
Czech hints: plíce/plicní=lung, bronchus/průduška=bronchus, pohrudnice/pleura/fluidothorax=pleura,
uzliny/lymfatické=lymph_node, játra/jaterní/hepatální=liver, pankreas/slinivka=pancreas, žlučník/žlučové cesty/
choledochus=gallbladder, duodenum/dvanáctník=duodenum, žaludek=stomach, jícen=esophagus, kolon/tlusté střevo/sigma/
céka=colon, rektum/konečník=rectum, slezina=spleen, ledvina=kidney, nadledvina=adrenal_gland, mozek=brain,
kost/skelet/obratel=bone, prs/mamma=breast, cévy/tepna/žíla/VMS/AMS/v. portae/truncus=blood_vessel,
peritoneum/ascites=skip. quote must be copied exactly from the input."""

_jobs: dict[int, dict] = {}
_lock = threading.Lock()


def _sections(doc) -> list[str]:
    """Report text without the identity header, cut into pieces the LLM's context can hold."""
    parts = [t for head, t in doc.sections.items() if head not in ("_header", "_footer") and t.strip()]
    text = "\n".join(parts) or doc.full_text
    out, buf = [], ""
    for line in text.splitlines():
        if len(buf) + len(line) > CHUNK and buf:
            out.append(buf)
            buf = ""
        buf += line + "\n"
    if buf.strip():
        out.append(buf)
    return out


def organs_named(quote: str) -> list[str]:
    """Organs a quote names, in the order they appear."""
    q = fold(quote)
    hits = [(m.start(), key) for key, pat in ORGAN_WORDS.items() if (m := re.search(pat, q))]
    return [key for _, key in sorted(hits)]


SENTENCE = re.compile(r"(?<=[.;])\s+(?=[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ])")
# a negating word and up to 3 words after it, not crossing punctuation or the next negation
NEGATED = re.compile(r"\b(bez|negativni|zadne?|nezvetsen\w*|neprokazan\w*)\b(\s+(?!bez\b)[^\s,;.:]+){0,3}")
# positive wording → status, most specific first
POSITIVE_KINDS = [
    ("metastasis", r"metast|generaliz"),
    ("involved", r"infiltr|prorust|kontakt|obkruz|postizen"),
    ("suspicious", r"suspekt|susp\.|bi-rads [45]|spikul|nejasn"),
    ("primary", r"karcinom|tumor|nador|malign|neoplaz"),
]
LEFT = re.compile(r"\b(vlevo|lev(y|a|e|eho|em|ou|ych|emu))\b")
RIGHT = re.compile(r"\b(vpravo|prav(y|a|e|eho|em|ou|ych|emu))\b")


def segment_status(segment: str) -> str | None:
    """Status a piece of Czech text states unambiguously, or None. "bez ložisek / bez nádoru" is negative,
    "kontakt tumoru …, bez zúžení lumen" stays positive (only the negated words are ignored)."""
    kept = NEGATED.sub(" ", segment)
    for status, pat in POSITIVE_KINDS:
        if re.search(pat, kept):
            return status
    return "negative" if (kept != segment or NEGATIVE.search(segment)) else None


def side_of(text: str) -> str | None:
    left, right = bool(LEFT.search(text)), bool(RIGHT.search(text))
    return "both" if left and right else "left" if left else "right" if right else None


def check_site(site: BodySite, source: str) -> list[dict]:
    """Verify one model answer against the report and turn it into findings, one per organ the quote names.

    The quote must occur in the report. It is split into sentences, and each sentence into one piece per organ it
    names; the wording of that piece sets the status where it is unambiguous ("metastáza", "suspektní",
    "bez ložisek", …), otherwise the model's status is kept for the model's own organ. A small model often files a
    finding under the wrong organ or calls a whole histology conclusion "negative" because of "HER2 negativní";
    the text decides instead."""
    match = quote_match(site.quote, source)
    if not match:
        return []  # not in the report
    out = []
    for sentence in SENTENCE.split(site.quote.strip()):
        s = fold(sentence)
        hits = sorted((m.start(), m.end(), key) for key, pat in ORGAN_WORDS.items() if (m := re.search(pat, s)))
        if not hits:
            continue  # no organ named ("bez známek vzdálených metastáz")
        for i, (start, end, organ) in enumerate(hits):
            seg = s[(hits[i - 1][1] if i else 0):(hits[i + 1][0] if i + 1 < len(hits) else len(s))]
            status = segment_status(seg)
            if status is None:
                if organ != site.organ or len(hits) > 1:
                    continue  # the model's status only counts when the sentence is about its organ alone
                status = site.status
                if status == "negative":
                    continue  # "negative" without any negating word: not trustworthy
            if status == "metastasis" and organ in ("lymph_node", "blood_vessel"):
                status = "involved"  # nodal / vascular spread is regional involvement, not a distant metastasis
            out.append({"organ": organ, "status": status, "side": side_of(seg) or side_of(s),
                        "quote": sentence.strip(), "match": match})
    return out


def extract_document(text_parts: list[str]) -> list[dict]:
    """The LLM over each piece of one report → verified, de-duplicated findings."""
    out, seen = [], set()
    for part in text_parts:
        try:
            found = llm.extract(BodySites, INSTRUCTION, part)
        except llm.LLMUnavailable as e:
            raise RuntimeError(str(e)) from e
        for site in found.sites:
            for finding in check_site(site, part):
                key = (finding["organ"], fold(finding["quote"]))
                if key not in seen:
                    seen.add(key)
                    out.append(finding)
    return out


def merge(evidence: list[dict], pathway_code: str) -> list[dict]:
    """One entry per organ. Most severe status wins; positive + negative evidence → conflict."""
    allowed_primary = PRIMARY.get(pathway_code, [])
    by_organ: dict[str, dict] = {}
    for ev in evidence:
        status = ev["status"]
        if status == "primary" and allowed_primary and ev["organ"] not in allowed_primary:
            status = "suspicious"  # a second "primary" outside the pathway organ: let the MDT judge it
        if status in ("metastasis", "involved") and ev["organ"] in allowed_primary:
            status = "primary"  # the tumour in its own organ is the primary site
        ev = {**ev, "status": status}
        site = by_organ.setdefault(ev["organ"], {"organ": ev["organ"], "evidence": [], "sides": set()})
        site["evidence"].append(ev)
    for key in allowed_primary[:1]:
        if not any(e["status"] == "primary" for s in by_organ.values() if s["organ"] in allowed_primary
                   for e in s["evidence"]):
            site = by_organ.setdefault(key, {"organ": key, "evidence": [], "sides": set()})
            site["fallback"] = True
    out = []
    for key, site in by_organ.items():
        ids, cs, en = ORGANS[key]
        evs = site["evidence"]
        statuses = [e["status"] for e in evs] or ["primary"]
        status = max(statuses, key=SEVERITY.index)
        if site.get("fallback"):
            status = "primary"
        positive = [e for e in evs if e["status"] != "negative"]
        negative = [e for e in evs if e["status"] == "negative"]
        # the side shown is where the findings are; "pravý prs bez ložisek" does not contradict a left tumour
        sides = {e["side"] for e in (positive or evs) if e.get("side")}
        same_side = lambda a, b: not a["side"] or not b["side"] or a["side"] == b["side"] or "both" in (a["side"], b["side"])  # noqa: E731
        # different lymph node stations / vessels can differ without contradicting each other
        conflict = key not in ("lymph_node", "blood_vessel") and any(same_side(p, n) for p in positive for n in negative)
        out.append({
            "organ": key, "uberon": ids, "label": cs, "label_en": en, "status": status,
            "side": "both" if "both" in sides or len(sides) > 1 else next(iter(sides), None),
            "conflict": conflict,
            "from_pathway": bool(site.get("fallback")),
            "evidence": sorted(site["evidence"], key=lambda e: (e["date"] or "", e["doc_id"])),
        })
    return sorted(out, key=lambda s: (-SEVERITY.index(s["status"]), s["label_en"]))


def sex_from_rc(rc: str) -> str | None:
    m = re.match(r"\d{2}(\d{2})", rc or "")
    if not m:
        return None
    return "female" if int(m.group(1)) > 50 else "male"


def _case_inputs(case_id: int) -> dict:
    from backend.workflow import service as svc
    from backend.workflow.db import Case, Document, session_scope, today
    with session_scope() as s:
        c = s.get(Case, case_id)
        if not c:
            raise ValueError(f"case {case_id} not found")
        cutoff = c.mdt_date or today(s)
        docs = s.query(Document).filter(Document.case_id == case_id, Document.status == "done").all()
        rows = [{"id": d.id, "title": d.title or d.filename, "date": d.doc_date.isoformat() if d.doc_date else None,
                 "type": d.doc_type, "path": str(svc._abs(d.path)), "sha": d.sha256}
                for d in docs if d.doc_type not in SKIP_TYPES and not (d.doc_date and d.doc_date > cutoff)]
        return {"cutoff": cutoff.isoformat(), "rc": c.rc, "pathway": c.pathway_version.pathway.code,
                "docs": sorted(rows, key=lambda r: (r["date"] or "", r["id"]))}


def _signature(inputs: dict) -> str:
    raw = json.dumps([inputs["cutoff"], inputs["pathway"], [(d["id"], d["sha"]) for d in inputs["docs"]],
                      INSTRUCTION, ORGAN_WORDS, settings.llm_model], sort_keys=True)
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def _path(case_id: int):
    return STORE / f"{case_id}.json"


def compute(case_id: int, progress=lambda done, total: None) -> dict:
    inputs = _case_inputs(case_id)
    evidence, docs = [], inputs["docs"]
    for i, d in enumerate(docs):
        progress(i, len(docs))
        doc = read_document(Path(d["path"]))
        for ev in extract_document(_sections(doc)):
            evidence.append({**ev, "doc_id": d["id"], "title": d["title"], "date": d["date"]})
    progress(len(docs), len(docs))
    result = {
        "case_id": case_id, "computed_on": date.today().isoformat(), "cutoff": inputs["cutoff"],
        "model": settings.llm_model, "signature": _signature(inputs),
        "sex": sex_from_rc(inputs["rc"]), "pathway": inputs["pathway"],
        "documents": [{"id": d["id"], "title": d["title"], "date": d["date"]} for d in docs],
        "sites": merge(evidence, inputs["pathway"]),
    }
    _path(case_id).write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
    return result


def _run(case_id: int) -> None:
    def progress(done: int, total: int) -> None:
        _jobs[case_id].update(done=done, total=total)
    try:
        compute(case_id, progress)
        _jobs[case_id]["status"] = "done"
    except Exception as e:  # shown in the panel; the previous result stays available
        log.exception("body map for case %s failed", case_id)
        _jobs[case_id].update(status="error", error=str(e))


def start(case_id: int) -> dict:
    """Start (or join) the background job for a case."""
    with _lock:
        job = _jobs.get(case_id)
        if not job or job["status"] != "running":
            _jobs[case_id] = {"status": "running", "done": 0, "total": 0, "error": ""}
            threading.Thread(target=_run, args=(case_id,), daemon=True, name=f"bodymap-{case_id}").start()
    return status(case_id)


def status(case_id: int) -> dict:
    """Stored result (if any), whether it is out of date, and the state of a running job."""
    path = _path(case_id)
    result = json.loads(path.read_text(encoding="utf-8")) if path.exists() else None
    inputs = _case_inputs(case_id)
    job = _jobs.get(case_id, {"status": "idle", "done": 0, "total": 0, "error": ""})
    return {
        "job": job, "result": result,
        "stale": result is None or result.get("signature") != _signature(inputs),
        "sex": sex_from_rc(inputs["rc"]), "pathway": inputs["pathway"], "organs": {
            k: {"uberon": ids, "label": cs, "label_en": en} for k, (ids, cs, en) in ORGANS.items()},
    }
