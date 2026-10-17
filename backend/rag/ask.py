"""GraphRAG for the MDT panel: "ask the case".

1. Retrieve  – the LLM turns the question (EN or CS) into Czech search terms; the IRIS chunk index
               (backend/rag/index.py) fuses BM25 over those terms with vector search on the question (RRF).
2. Graph     – the patient graph (IRIS globals) adds key facts (diagnosis, exams, comorbidities, medication, key
               labs) and the FHIR Patient adds identity, each tagged with the document that states it.
3. Answer    – the LLM answers only from that context, citing documents as [D<id>].
4. Ground    – deterministic check: the answer's numbers / words must occur in a cited source, otherwise it is
               flagged "not backed by a document". The model's own "found" flag is not trusted.
Only documents dated on/before the cut-off (the MDT date) are used.
"""
from __future__ import annotations

import re
from datetime import date

from backend.extract import llm
from backend.extract.schemas import CaseAnswer, Keywords
from backend.graph.store import graph
from backend.ingest.reader import DocText, fold
from backend.rag import index

CHUNK = 650


def chunks(doc: DocText) -> list[dict]:
    """Section-sized pieces of a document for full-text search."""
    out: list[dict] = []
    head = " ".join(x for x in [doc.title, doc.header.get("facility", ""), str(doc.header.get("doc_date") or "")] if x)
    for section, text in doc.sections.items():
        if section in ("_footer",) or not text.strip():
            continue
        label = "" if section == "_header" else section
        buf = ""
        for line in text.splitlines():
            if len(buf) + len(line) > CHUNK and buf:
                out.append({"section": label, "text": f"{head}\n{label}\n{buf}".strip()})
                buf = ""
            buf += line + "\n"
        if buf.strip():
            out.append({"section": label, "text": f"{head}\n{label}\n{buf}".strip()})
    return out


STOP = {"what", "whats", "the", "and", "is", "are", "was", "were", "does", "did", "has", "have", "with", "for", "this",
        "that", "which", "when", "how", "value", "jaky", "jaka", "jake", "byla", "bylo", "kdy", "jak", "uziva", "pred",
        "pro", "name", "jmeno"}


def keywords(question: str) -> list[str]:
    words = [w for w in re.findall(r"[\wÀ-ž\-]{3,}", question)]
    try:
        k = llm.extract(Keywords, (
            "Give 3-8 Czech medical search terms for finding the answer to this question in Czech medical reports "
            "(e.g. 'CT', 'histologie', 'CA 19-9', 'apixaban', 'hmotnost', 'bolest'). Translate English terms to Czech."),
            question).keywords
    except llm.LLMUnavailable:
        k = []
    words = [w for w in words if fold(w) not in STOP]
    seen, out = set(), []
    for t in [*k, *(words if len(k) < 3 else [])]:
        f = fold(t)
        if f not in seen and len(t) >= 2:
            seen.add(f)
            out.append(t)
    return out[:12]


def retrieve(patient_uuid: str, terms: list[str], cutoff: date, limit: int = 6, question: str | None = None) -> list[dict]:
    """Chunks of the patient's documents dated on/before the cut-off: keyword hits for `terms`, plus semantic
    hits for `question` when an embedding model is configured."""
    if not terms and not question:
        return []
    return index.search(patient_uuid, terms, cutoff, limit, question)


def core_facts(patient_uuid: str, cutoff: date) -> list[tuple[int | None, str]]:
    """The graph part of GraphRAG: identity + key facts, each line tagged with the document that states it."""
    out: list[tuple[int | None, str]] = []
    p = graph.patient(patient_uuid)
    snap = graph.snapshot(patient_uuid)
    first = sorted(snap.documents(cutoff, allow_undated=False), key=lambda d: (d.get("type") != "referral", d["date"]))
    ref = first[0].get("sqlite_id") if first else None
    if p:
        sex = {"F": "žena / female", "M": "muž / male"}.get(p.get("sex", ""), "")
        dob = p.get("dob")
        born = f"narozen(a) / born {dob:%d.%m.%Y}; " if dob else ""
        out.append((ref, f"Pacient / patient name: {p.get('patient_name', '')}; RČ {p.get('rc', '')}; {born}{sex}; "
                         f"ZP {p.get('insurer', '')}; {p.get('address', '')}; tel. {p.get('phone', '')}"))
    keep = {"diagnosis", "exam", "condition", "medication", "contact_person", "allergy", "lab"}
    fields = ("kind", "name", "label", "conclusion", "analyte", "value", "unit", "flag", "dose", "schedule",
              "relation", "phone", "text")
    agg: dict[str, dict] = {}
    for f, d, _ in snap.edges(cutoff=cutoff, allow_undated=True):  # oldest document first
        if f.get("kind") not in keep or (f["kind"] == "lab" and f.get("flag") is None and not f.get("is_tumor_marker")):
            continue
        a = agg.setdefault(f["id"], {**{k: f.get(k) for k in fields}, "doc_id": d.get("sqlite_id"), "date": None})
        if d.get("date") and (a["date"] is None or d["date"] < a["date"]):
            a["date"] = d["date"]
    rows = sorted(agg.values(), key=lambda r: (r["date"] is None, r["date"] or date.min))
    labs = []
    for r in rows:
        when = f"{r['date']:%d.%m.%Y}" if r["date"] else ""
        k = r["kind"]
        if k == "diagnosis":
            out.append((r["doc_id"], f"{when} Diagnóza / diagnosis: {r['name']}"))
        elif k == "exam" and r["label"] != "Laboratorní vyšetření":
            out.append((r["doc_id"], f"{when} {r['label']}: {(r['conclusion'] or '')[:220]}"))
        elif k == "condition":
            out.append((r["doc_id"], f"Komorbidita / comorbidity: {r['name']}"))
        elif k == "medication":
            out.append((r["doc_id"], f"Lék / medication: {r['name']} {r['dose'] or ''} {r['schedule'] or ''}".strip()))
        elif k == "contact_person":
            out.append((r["doc_id"], f"Kontaktní osoba / contact person: {r['name']} ({r['relation'] or ''}) {r['phone'] or ''}"))
        elif k == "allergy":
            out.append((r["doc_id"], f"Alergie / allergies: {r['text']}"))
        elif k == "lab":
            labs.append((r["doc_id"], f"{when} {r['analyte']} {r['value']} {r['unit'] or ''} {r['flag'] or ''}".strip()))
    return out + labs[-14:]  # keep it compact for a 4B model


NEGATIVE = re.compile(r"^(no|ne|není uvedeno|neuvedeno|not (found|stated|mentioned)|unknown|nevím|false|true|none|"
                      r"n/?a|null|nenalezeno)\W*$", re.I)
GENERIC = {"patient", "pacient", "pacientka", "document", "documents", "value", "hodnota", "context", "according"}


def ask(patient_uuid: str, question: str, cutoff: date, lang: str = "en") -> dict:
    terms = keywords(question)
    hits = retrieve(patient_uuid, terms, cutoff, question=question)
    facts = core_facts(patient_uuid, cutoff)
    context = ("CASE FACTS (from the patient graph):\n" + "\n".join(f"[D{d}] {line}" for d, line in facts)
               + "\n\nDOCUMENT EXCERPTS:\n" + "\n\n".join(
                   f"[D{h['doc_id']}] {h['title']} ({h['date']:%d.%m.%Y})\n{h['text']}" for h in hits))
    language = "English" if lang == "en" else "Czech"
    try:
        r = llm.extract(CaseAnswer, (
            f"LANGUAGE: write the answer in {language}, even though the documents are in Czech. "
            f"You are assisting a cancer multidisciplinary team (MDT). Answer the question using ONLY the context "
            f"(case facts first, then document excerpts). Answer every part of the question. Put the source after "
            f"each fact as [D<number>]. If something is not in the context, say it is not in the documents - never "
            f"conclude that a finding is absent just because it is not mentioned. No treatment advice. "
            f"QUESTION: {question}"), context[:7000])
        answer = re.sub(r"<unused\d+>\w*", "", r.answer).strip()
        if not answer:
            raise llm.LLMUnavailable("empty answer")
        known = {h["doc_id"] for h in hits} | {d for d, _ in facts}
        answer += "".join(f" [D{d}]" for d in dict.fromkeys(r.cited_documents) if f"[D{d}]" not in answer and d in known)
    except llm.LLMUnavailable:
        answer = ("The LLM could not answer – showing the matching document excerpts only." if lang == "en"
                  else "LLM neodpověděl – zobrazuji pouze nalezené úryvky dokumentů.")

    # Deterministic grounding: a source backs the answer if a number from the answer (≥2 digits, e.g. 312) or two
    # distinctive words occur in it. Model-written citations only count if they are backed the same way.
    body = re.sub(r"\[D\d+\]", "", answer).strip()
    numbers = {n.replace(",", ".") for n in re.findall(r"\d{2,}(?:[.,]\d+)?", body)}
    words = {fold(w) for w in re.findall(r"[^\W\d_]{5,}", body)} - GENERIC
    score: dict[int, int] = {}
    supports: list[tuple[int | None, str]] = [(h["doc_id"], h["text"]) for h in hits] + facts
    for doc_id, text in supports:
        if doc_id is None:
            continue
        f = fold(text).replace(",", ".")
        tokens = set(re.findall(r"\d+(?:\.\d+)?", f))
        n_hit = sum(1 for n in numbers if n in tokens)
        w_hit = sum(1 for w in words if w in f)
        if n_hit or w_hit >= 2:
            score[doc_id] = max(score.get(doc_id, 0), 2 * n_hit + w_hit)
    best = max(score.values(), default=0)
    # keep only the strongest sources (a dose like "10" appears in many documents)
    cited = {d for d, sc in sorted(score.items(), key=lambda x: -x[1])[:3] if sc >= 0.6 * best}
    negative = bool(NEGATIVE.match(body))
    translation = None
    if lang == "en" and not negative and len(re.findall(r"[ěščřžůúáéíóýĚŠČŘŽŮÚÁÉÍÓÝ]", body)) >= 3:
        # The 4B model often copies the Czech source. Keep that verbatim answer (it is what the document says) and add
        # a clearly labelled machine translation – a 4B translation can be wrong (e.g. "duktální" ≠ "duodenal").
        try:
            t = llm.write("Translate this medical text from Czech to English literally. Keep numbers, units, "
                               "drug names and abbreviations unchanged. Output only the translation.", body, max_tokens=300)
            translation = t.replace("**", "").strip() or None
        except llm.LLMUnavailable:
            pass
    grounded = bool(cited) and not negative
    if negative:
        answer = ("Not found in the patient's documents up to the MDT date." if lang == "en"
                  else "V dokumentaci pacienta (do data MDT) nenalezeno.")
    else:
        # show only the citations that are actually backed
        answer = re.sub(r"\s*\[D(\d+)\]", lambda m: f" [D{m.group(1)}]" if int(m.group(1)) in cited else "", answer)
        answer += "".join(f" [D{d}]" for d in sorted(cited) if f"[D{d}]" not in answer)

    sources: dict[int, dict] = {}
    for h in hits:
        if h["doc_id"] is None:
            continue
        s = sources.setdefault(h["doc_id"], {"doc_id": h["doc_id"], "title": h["title"], "date": h["date"],
                                             "snippets": [], "cited": h["doc_id"] in cited})
        if len(s["snippets"]) < 2:
            s["snippets"].append(h["text"].split("\n", 2)[-1][:280])
    for d in cited - set(sources):
        doc = graph.document_by_sqlite_id(d)
        if doc:
            sources[d] = {"doc_id": d, "title": doc.get("title"), "date": doc.get("date"), "snippets": [], "cited": True}
    return {"question": question, "answer": answer, "translation": translation, "terms": terms, "cutoff": cutoff,
            "grounded": grounded,
            "sources": sorted(sources.values(), key=lambda s: (not s["cited"], s["date"] or date.min))}
