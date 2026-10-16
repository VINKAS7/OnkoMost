"""One document → a list of facts (each with a source quote) + flags.

Rules handle everything with a fixed shape (header, labelled anamnesis lines, labs, measurements, codes,
dates). MedGemma only turns free-text sections into lists (conditions, symptoms, notes, MDT question) and
medications when the rule parser finds nothing. Every model output is checked against the source.
"""
from __future__ import annotations

import logging
import re
from dataclasses import asdict, dataclass, field
from datetime import date

from backend.extract import medgemma
from backend.extract.labs import abnormal_summary, parse_labs
from backend.extract.schemas import INSTRUCTIONS, Conditions, MdtQuestion, Medications, Symptoms
from backend.extract.verify import quote_match
from backend.ingest.classify import EXAM_LABELS, classify, facility_display, specialty
from backend.ingest.identity import rc_info
from backend.ingest.reader import DATE_RE, DocText, all_dates, fold, parse_date

log = logging.getLogger(__name__)

ANTICOAGULANTS = ("apixaban", "rivaroxaban", "dabigatran", "edoxaban", "warfarin", "enoxaparin", "nadroparin")


@dataclass
class Fact:
    kind: str
    key: str
    props: dict
    quote: str = ""
    match: str | None = "exact"  # exact | approx | None (unverified)
    method: str = "rule"  # rule | medgemma | coordinator
    section: str = ""


@dataclass
class Extraction:
    doc_type: str
    exam_type: str | None
    title: str
    doc_date: date | None
    facility: str
    author: str
    header: dict
    facts: list[Fact] = field(default_factory=list)
    flags: list[dict] = field(default_factory=list)
    llm_calls: int = 0
    llm_errors: list[str] = field(default_factory=list)

    def summary(self) -> dict:
        kinds: dict[str, int] = {}
        for f in self.facts:
            kinds[f.kind] = kinds.get(f.kind, 0) + 1
        return {
            "facts": kinds,
            "unverified": sum(1 for f in self.facts if f.match is None),
            "medgemma_items": sum(1 for f in self.facts if f.method == "medgemma"),
            "llm_calls": self.llm_calls,
            "llm_errors": self.llm_errors,
            "flags": len(self.flags),
        }

    def to_dict(self) -> dict:
        return {"facts": [asdict(f) for f in self.facts], "flags": self.flags}


def slug(text: str, words: int = 3) -> str:
    stop = {"st", "p", "a", "na", "od", "pro", "s", "v", "r", "po", "se"}
    toks = [t for t in re.findall(r"[a-z0-9]+", fold(text)) if t not in stop]
    return "-".join(toks[:words]) or "x"


def split_top_level(text: str, sep: str = ",") -> list[str]:
    """Split on commas that are not inside parentheses."""
    out, depth, cur = [], 0, ""
    for ch in text:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth = max(0, depth - 1)
        if ch == sep and depth == 0:
            out.append(cur.strip())
            cur = ""
        else:
            cur += ch
    if cur.strip():
        out.append(cur.strip())
    return out


def labelled_line(doc: DocText, label: str) -> str:
    for b in doc.blocks:
        if b.kind == "p":
            m = re.match(rf"^{label}:\s*(.+)$", b.text)
            if m:
                return m.group(1).strip()
    return ""


MED_RE = re.compile(
    r"^(?P<name>[a-záčďéěíňóřšťúůýž][\w\-]*(?:\s+(?:tbl\.|ret\.|sirup|i\.v\.))*)\s+"
    r"(?P<dose>\d+(?:[.,]\d+)?\s*(?:mg|g|µg|mcg|ml|IU|j\.))\s*(?P<schedule>.*)$", re.I)


def rule_medications(text: str) -> list[dict]:
    meds = []
    for part in (p for line in text.splitlines() for p in split_top_level(line)):
        m = MED_RE.match(part.strip())
        if m:
            meds.append({"name": m.group("name").strip(), "dose": m.group("dose").strip(),
                         "schedule": m.group("schedule").strip(" ,") or None, "quote": part.strip()})
    return meds


NOT_SYMPTOM = re.compile(r"\bbez\b|neguje|nemel|nema\b|sobestac|pracovni neschopnost|uleva|zhorsuji se|afebrilni")


def is_not_a_symptom(name: str, onset: str | None, quote: str | None) -> bool:
    """MedGemma 4B sometimes lists denied symptoms ('bez dušnosti'), status remarks or bare time phrases
    ('v noci'); drop those."""
    if re.match(r"^(v|ve|po|pri|od|do|na)\s", fold(name).strip()):
        return True
    return bool(NOT_SYMPTOM.search(fold(" ".join(x for x in (name, onset or "", quote or "") if x))))


def merge_fragments(items: list) -> list:
    """Glue trailing qualifiers the model split off ('…, neléčena') back onto the previous condition."""
    out = []
    for it in items:
        if out and re.fullmatch(r"(ne)?lecen[aoy]?|kompenzovan[aey]?|(na\s+)?antikoagulac\w*", fold(it.name).strip(" .")):
            out[-1].name = f"{out[-1].name}, {it.name}"
            continue
        out.append(it)
    return out


NOTE_RULES = [
    ("consent", r"souhlasi se sdilenim"),
    ("wish", r"\bpreje\b|\bprani\b"),
    ("warning", r"upozornuji|antikoagula|vysazeni|alergi"),
    ("psychosocial", r"uzkost|psycholog|spatne spi|depres"),
    ("information", r"je o podezreni|je informovan"),
]


def note_category(sentence: str) -> str | None:
    f = fold(sentence)
    for cat, pat in NOTE_RULES:
        if re.search(pat, f):
            return cat
    return None


class Extractor:
    def __init__(self, doc: DocText, use_llm: bool = True):
        self.doc = doc
        self.use_llm = use_llm
        doc_type, exam_type = classify(doc)
        self.x = Extraction(
            doc_type=doc_type, exam_type=exam_type, title=doc.title, doc_date=doc.header.get("doc_date"),
            facility=facility_display(doc), author=doc.header.get("author", ""), header=doc.header)

    # -- helpers ---------------------------------------------------------------------------------
    def add(self, kind: str, key: str, props: dict, quote: str = "", method: str = "rule", section: str = "",
            source: str | None = None) -> None:
        match = "exact" if method == "rule" else quote_match(quote, source if source is not None else self.doc.full_text)
        self.x.facts.append(Fact(kind, key, props, quote, match, method, section))

    def llm(self, schema, instruction_key: str, text: str):
        if not self.use_llm or not text.strip():
            return None
        try:
            self.x.llm_calls += 1
            return medgemma.extract(schema, INSTRUCTIONS[instruction_key], text)
        except medgemma.LLMUnavailable as e:
            self.x.llm_errors.append(str(e))
            self.use_llm = False
            return None

    # -- rules -----------------------------------------------------------------------------------
    def patient(self) -> None:
        h = self.doc.header
        if not h.get("rc") and not h.get("patient_name"):
            return
        info = rc_info(h["rc"]) if h.get("rc") else {}
        props = {k: h[k] for k in ("patient_name", "rc", "insurer", "address", "phone") if h.get(k)}
        if h.get("dob") or info.get("dob"):
            props["dob"] = h.get("dob") or info.get("dob")
        if info.get("sex"):
            props["sex"] = info["sex"]
        quote = next((b.text for b in self.doc.blocks if b.kind == "p" and b.text.startswith("Pacient")), "")
        self.add("patient", "patient", props, quote)
        if h.get("contact_person"):
            cp = h["contact_person"]
            m = re.match(r"^(?P<name>[^(,]+)\s*(?:\((?P<rel>[^)]+)\))?,?\s*(?:tel\.?\s*(?P<tel>\+?[\d ]+))?", cp)
            props = {"text": cp}
            if m:
                props.update({"name": m.group("name").strip(), "relation": m.group("rel"),
                              "phone": (m.group("tel") or "").strip() or None})
            self.add("contact_person", slug(props.get("name", cp), 2), props, f"Kontaktní osoba: {cp}")

    def referring_doctor(self) -> None:
        lines = self.doc.header.get("facility_lines", [])
        name = next((l for l in lines if re.match(r"(?:doc\.\s*)?MUDr\.", l)), self.doc.header.get("author", ""))
        address = next((l for l in lines if re.search(r"\d{3}\s?\d{2}", l) and not l.startswith("IČP")), "")
        props = {"name": name.split(",")[0].strip(), "practice": lines[0] if lines else "", "address": address,
                 "phone": self.doc.header.get("facility_phone")}
        m = re.search(r"IČP:\s*(\d+)", " ".join(lines))
        if m:
            props["icp"] = m.group(1)
        self.add("referring_doctor", slug(props["name"], 3), props, name)

    def measurements(self) -> None:
        text = self.doc.full_text
        for kind, pat, unit in [("height", r"Výška\s+(\d{2,3})\s*cm", "cm"), ("weight", r"[Hh]motnost\s+(\d{2,3})\s*kg", "kg")]:
            for m in re.finditer(pat, text):
                self.add("measurement", f"{kind}", {"measure": kind, "value": float(m.group(1)), "unit": unit,
                                                    "date": self.x.doc_date}, m.group(0))
        for m in re.finditer(r"\b(ECOG|PS)\s*[:=]?\s*([0-4])\b|Karnofsk\w*\s*(?:skóre)?\s*[:=]?\s*(\d{2,3})\s*%?", text):
            if m.group(1):
                props = {"measure": "performance_status", "scale": "ECOG", "value": float(m.group(2))}
            else:
                props = {"measure": "performance_status", "scale": "Karnofsky", "value": float(m.group(3))}
            props["date"] = self.x.doc_date
            self.add("measurement", "performance_status", props, m.group(0))

    def anamnesis(self) -> None:
        sec = "ANAMNÉZA"
        oa = labelled_line(self.doc, "OA")
        if oa:
            res = self.llm(Conditions, "conditions", oa)
            if res and res.conditions:
                for c in merge_fragments(res.conditions):
                    # key on the quoted source text so the same condition from two letters merges into one node
                    verbatim = quote_match(c.quote, oa)
                    name_exact = quote_match(c.name, oa) == "exact"
                    # "copy, don't paraphrase": if the model reworded the name, show the source text instead
                    name = c.name if name_exact or not verbatim else c.quote.strip(" ,.")
                    # merge key: the verbatim name (same wording in every GP letter), else the quote
                    key = slug(c.name if name_exact else (c.quote if verbatim else c.name), 2)
                    self.add("condition", key, {"name": name, "since": c.since}, c.quote, "medgemma", sec, oa)
            else:
                for part in split_top_level(oa):
                    if len(part) > 3:
                        self.add("condition", slug(part, 2), {"name": part}, part, "rule", sec)
        fa = labelled_line(self.doc, "FA")
        if fa:
            self.medications(fa, sec)
        aa = labelled_line(self.doc, "AA")
        if aa:
            self.add("allergy", "allergy", {"text": aa, "none": fold(aa).startswith("neguje")}, f"AA: {aa}", section=sec)
        for label, cat in [("RA", "family_history"), ("SA", "social"), ("PA", "work"), ("Abusus", "abusus")]:
            v = labelled_line(self.doc, label)
            if v:
                self.add("note", f"{cat}", {"category": cat, "text": v}, f"{label}: {v}", section=sec)

    def medications(self, text: str, section: str) -> None:
        meds = rule_medications(text)
        if meds:
            for m in meds:
                self.add("medication", slug(m["name"], 1), {k: m[k] for k in ("name", "dose", "schedule")}, m["quote"],
                         "rule", section)
            return
        res = self.llm(Medications, "medications", text)
        for m in (res.medications if res else []):
            self.add("medication", slug(m.name, 1), {"name": m.name, "dose": m.dose, "schedule": m.schedule}, m.quote,
                     "medgemma", section, text)

    def coded_diagnoses(self) -> None:
        """Lines starting with an ICD-10 code. C/D0x codes = cancer diagnosis, others = comorbidity."""
        for b in self.doc.blocks:
            if b.kind != "p":
                continue
            m = re.match(r"^(?:Suspektní diagnóza:\s*)?([A-Z]\d{2}(?:\.\d)?)\s*[–-]?\s*(.+)$", b.text)
            if not m:
                continue
            code, name = m.group(1), m.group(2).strip()
            suspected = b.text.startswith("Suspektní")
            if code.startswith("C") or code.startswith("D0"):
                self.add("diagnosis", code, {"icd10": code, "name": name,
                                             "status": "suspected" if suspected else "stated"}, b.text, section=b.section)
            elif b.section and fold(b.section).startswith(("diagnoz", "zaver")):
                self.add("condition", slug(name, 2), {"name": name.split(",")[0], "icd10": code}, b.text, section=b.section)

    def mentioned_exams(self) -> None:
        sec = self.doc.section("PROVEDENÁ VYŠETŘENÍ")
        for line in sec.splitlines():
            m = re.match(rf"^\d+\.\s+(?P<label>.+?)\s+(?P<date>{DATE_RE})\s*(?P<rest>.*)$", line)
            if not m:
                continue
            place = re.findall(r"\(([^)]+)\)", m.group("rest"))
            self.add("mentioned_exam", parse_date(m.group("date")).isoformat(),
                     {"label": m.group("label").strip(" –-"), "date": parse_date(m.group("date")),
                      "place": place[-1] if place else "", "detail": m.group("rest").strip(" –-")}, line,
                     section="PROVEDENÁ VYŠETŘENÍ")

    def epikriza_and_request(self) -> None:
        epi = self.doc.section("EPIKRÍZA")
        if epi:
            self.add("epikriza", "epikriza", {"text": epi, "doc_type": self.x.doc_type}, epi[:200], section="EPIKRÍZA")
            self.symptoms(epi, "EPIKRÍZA")
        req = self.doc.section("ŽÁDOST")
        if req:
            # The request is a plain "Žádám o …" sentence; copying it verbatim beats asking a 4B model.
            sentences = [x for line in req.splitlines() for x in re.split(r"(?<=\.)\s+", line)]
            ask = [s for s in sentences if re.match(r"^(Žádám|Prosím)", s) or "MDT" in s or "urgent" in s]
            if ask:
                self.add("mdt_question", "mdt_question", {"text": " ".join(ask)}, ask[0], section="ŽÁDOST")
            else:
                res = self.llm(MdtQuestion, "mdt_question", req)
                if res and res.question and quote_match(res.quote, req) and "referring doctor" not in res.question:
                    self.add("mdt_question", "mdt_question", {"text": res.question}, res.quote, "medgemma", "ŽÁDOST", req)
        if self.x.doc_type == "referral":
            for text, sec in [(req, "ŽÁDOST"), (epi, "EPIKRÍZA")]:
                for sentence in (x for line in (text or "").splitlines() for x in re.split(r"(?<=\.)\s+", line)):
                    cat = note_category(sentence)
                    if cat:
                        self.add("note", f"{cat}-{slug(sentence, 4)}", {"category": cat, "text": sentence.strip()},
                                 sentence.strip(), section=sec)

    def subjective_symptoms(self) -> None:
        sub = self.doc.section("SUBJEKTIVNĚ", "ANAMNÉZA BOLESTI")
        if sub and self.x.doc_type in {"specialist_report", "pain_report"}:
            self.symptoms(sub, "SUBJEKTIVNĚ")

    def symptoms(self, text: str, section: str) -> None:
        # One paragraph per call: a 4B model is more accurate (and never truncates) on short inputs.
        seen = set()
        objective = re.compile(r"^(objektivn|laboratorn|zaver|terapie|doporuceni|rtg|uz\b|ct\b)")
        for para in (p for p in text.splitlines() if len(p) > 30 and not objective.match(fold(p))):
            res = self.llm(Symptoms, "symptoms", para)
            for s in (res.symptoms if res else []):
                key = slug(s.symptom)
                if key in seen or is_not_a_symptom(s.symptom, s.onset, s.quote):
                    continue
                seen.add(key)
                onset = None if not s.onset or re.search(r"neuv|nezn|^-$", fold(s.onset)) else s.onset
                self.add("symptom", key, {"name": s.symptom, "onset": onset}, s.quote, "medgemma", section, para)

    def exam(self) -> None:
        if not self.x.exam_type:
            return
        conclusion = self.doc.section("ZÁVĚR", "DIAGNÓZA")
        if not conclusion:
            body = self.doc.section("POPIS VÝKONU", "POPIS")
            conclusion = " ".join(re.split(r"(?<=\.)\s+", body)[-3:]) if body else ""
        if self.x.exam_type == "lab":
            labs = parse_labs(self.doc)
            for i, l in enumerate(labs):
                self.add("lab", f"{slug(l['analyte'], 4)}-{i}", {**{k: v for k, v in l.items() if k != "quote"},
                                                                 "date": self.x.doc_date}, l["quote"], section=l["panel"])
            conclusion = abnormal_summary(labs) or "Bez patologických hodnot"
            result = "\n".join(f"{l['analyte']}: {l['value']} {l['unit']} (ref. {l['ref']}){' ' + l['flag'] if l['flag'] else ''}"
                               for l in labs)
        else:
            parts = []
            for head in ("POPIS", "POPIS VÝKONU", "MIKROSKOPICKY", "OBJEKTIVNĚ", "PSYCHOLOGICKÉ VYŠETŘENÍ", "ZÁVĚR",
                         "ZÁVĚR A DOPORUČENÍ", "DIAGNÓZA", "DOPORUČENÍ"):
                t = self.doc.sections.get(head)
                if t:
                    parts.append(f"{head}: {t}")
            result = "\n".join(parts) or self.doc.full_text
        label = EXAM_LABELS.get(self.x.exam_type, self.x.exam_type)
        if self.x.exam_type in {"ct", "ultrasound", "xray", "mri", "pet_ct", "eus_fnb", "specialist_visit"}:
            label = re.sub(r"^(Výsledek vyšetření|Protokol o výkonu|Ambulantní zpráva)\s*[–-]\s*", "", self.x.title) or label
            if self.x.exam_type == "specialist_visit" and specialty(self.doc):
                label = f"{specialty(self.doc)} – {label}"
        props = {"exam_type": self.x.exam_type, "label": label, "date": self.x.doc_date, "place": self.x.facility,
                 "conclusion": conclusion.strip(), "result_text": result.strip(), "author": self.x.author}
        if self.x.exam_type == "ct" and re.search(r"pankreatick\w* protokol", self.doc.full_text, re.I):
            props["protocol"] = "pancreatic"
        self.add("exam", f"{self.x.exam_type}-{self.x.doc_date}", props, conclusion[:300], section="ZÁVĚR")
        if self.x.exam_type == "histology":
            self.histology(conclusion)

    def histology(self, conclusion: str) -> None:
        first = re.split(r"\.\s", conclusion)[0].strip()
        grade = re.search(r"\bG\d(?:\s*[–-]\s*G\d)?\b", conclusion)
        morph = re.search(r"MKN-O\s+(\d{4}/\d)", conclusion)
        self.add("diagnosis", "histology", {"name": first, "status": "confirmed", "grade": grade.group(0) if grade else None,
                                            "morphology": morph.group(1) if morph else None,
                                            "perineural_invasion": "perineurální invaz" in conclusion},
                 conclusion, section="ZÁVĚR")

    def precautions(self) -> None:
        text = self.doc.full_text
        for drug in ANTICOAGULANTS:
            m = re.search(rf"{drug}\w*\s+vysazen\w*\s+(\d+)\s*h", text, re.I)
            if m:
                last = re.search(rf"poslední dávka\s+({DATE_RE})", text[m.start(): m.start() + 200])
                self.add("precaution", f"anticoagulant_paused-{drug}",
                         {"precaution": "anticoagulant_paused", "drug": drug, "hours": int(m.group(1)),
                          "last_dose": parse_date(last.group(1)) if last else None, "before": self.x.exam_type,
                          "date": self.x.doc_date}, text[m.start(): m.start() + 120].split("\n")[0])

    def date_sanity(self) -> None:
        """A past event (sample taken, last dose, done) dated after the document's own date is impossible."""
        if not self.x.doc_date:
            return
        for b in self.doc.blocks:
            if b.kind != "p" or fold(b.section).startswith("doporuceni"):
                continue
            for d, s, e in all_dates(b.text):
                if d <= self.x.doc_date:
                    continue
                context = fold(b.text[max(0, s - 40): s])
                if re.search(r"odber|posledni davka|vysazen|proveden", context):
                    start = b.text.rfind("(", 0, s)
                    start = start + 1 if start >= 0 and s - start < 60 else max(0, b.text.rfind(" ", 0, max(0, s - 40)) + 1)
                    snippet = b.text[start:e].strip()
                    self.x.flags.append({
                        "rule": "past_event_after_document_date",
                        "message": f"„{snippet}“ – datum {d:%d. %m. %Y} je pozdější než datum dokumentu "
                                   f"{self.x.doc_date:%d. %m. %Y}. Ověřte správné datum.",
                        "message_en": f"“{snippet}” – {d:%d %b %Y} is later than the document's own date "
                                      f"({self.x.doc_date:%d %b %Y}). One of the dates must be wrong – please verify.",
                        "quote": snippet,
                        "found_date": d, "doc_date": self.x.doc_date})

    def run(self) -> Extraction:
        t = self.x.doc_type
        if t == "mdt_conclusion":
            return self.x  # handled by reports.mdt
        self.patient()
        if t == "referral":
            self.referring_doctor()
            self.mentioned_exams()
        self.measurements()
        self.anamnesis()
        self.coded_diagnoses()
        if t in {"referral", "gp_summary"}:
            self.epikriza_and_request()
        self.subjective_symptoms()
        med_sec = self.doc.section("MEDIKACE", "TERAPIE")
        if med_sec:
            self.medications(med_sec, "MEDIKACE")
        self.exam()
        self.precautions()
        self.date_sanity()
        return self.x


def extract_document(doc: DocText, use_llm: bool = True) -> Extraction:
    return Extractor(doc, use_llm).run()
