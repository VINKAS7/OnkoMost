"""Decide which pathway document-steps an uploaded document fulfils.

Two sources, both kept as node_match facts:
  rule – the document's parsed type or exam equals what the step requires, or the step's title words appear in the
         document title (cheap, deterministic);
  llm  – the whole document goes to the LLM in ONE call together with every step it could fulfil (title and
         description). The model judges each step by its own description, returns the steps whose required data the
         document contains, each with a quote, and a step only counts when that quote is really in the document.
         The same call returns the document's date, for documents whose layout the rules do not know.
"""
from __future__ import annotations

import logging
import re
from datetime import date

from backend.extract import llm
from backend.extract.pipeline import Fact
from backend.extract.schemas import DocumentSteps
from backend.extract.verify import quote_match
from backend.ingest.reader import fold, parse_date
from backend.pathway.formats import format_ok

log = logging.getLogger(__name__)

MAX_TEXT = 12000  # characters of the document the model reads – a whole report fits

_INSTRUCTION = (
    "You check one uploaded medical document against the steps of a cancer pathway. Read the whole document. For "
    "each step, its description says which data it requires and what does not count. Judge every step ONLY by its "
    "own description: return the steps whose required data this document contains, following the description's "
    "rules exactly (if it says a mention in a letter does not count, a letter that only mentions the exam does not "
    "fulfil it). A document may fulfil several steps or none. step_id must be one of the ids in the list. quote must "
    "be an exact substring of the document that shows the required data. Also give the date the document itself was "
    "written or issued."
)


def _words(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]{3,}", fold(text or "")) if w not in
            {"the", "and", "pro", "zprava", "vysetreni", "vysledek", "dokument", "step", "report"}}


def _brief(node: dict) -> tuple[str, str]:
    title = " / ".join(p for p in (node.get("label_en") or "", node.get("label") or "") if p)
    desc = " / ".join(p for p in (node.get("description_en") or "", node.get("description") or "") if p)
    return title, desc


def _rule_match(node: dict, doc_type: str, exam_type: str | None, filename: str, title: str) -> bool:
    """Strong overlap: required exam/doc type, or the step title words appear in the document title."""
    nt, _ = _brief(node)
    blob = fold(f"{title} {doc_type} {exam_type or ''} {filename}")
    for req in node.get("requires") or []:
        kind = req.get("kind")
        if kind == "exam":
            types = req["exam_type"] if isinstance(req.get("exam_type"), list) else [req.get("exam_type")]
            if exam_type in types:
                return True
        if kind == "document" and doc_type == req.get("doc_type"):
            return True
    keys = _words(nt)
    return bool(keys) and len(keys & _words(blob)) >= min(2, len(keys))


def _llm_matches(steps: list[dict], *, doc_type: str, exam_type: str | None, filename: str, title: str,
                 text: str) -> tuple[dict[str, str], date | None]:
    """({step id: verified quote}, document date) as the LLM reads the document."""
    listing = "\n\n".join(f"STEP {n['id']}: {_brief(n)[0]}\n{_brief(n)[1]}" for n in steps)
    try:
        found = llm.extract(DocumentSteps, _INSTRUCTION,
                            f"PATHWAY STEPS:\n{listing}\n\n--- DOCUMENT ---\nFILE: {filename}\nTITLE: {title}\n"
                            f"PARSED TYPE: {doc_type} / {exam_type or '-'}\n\n{text[:MAX_TEXT]}", max_tokens=1500)
    except llm.LLMUnavailable:
        log.info("LLM step matching skipped for %s: model offline", filename)
        return {}, None
    known = {n["id"] for n in steps}
    out = {}
    for m in found.steps:
        if m.step_id in known and m.quote and quote_match(m.quote, text):
            out[m.step_id] = m.quote[:300]
        elif m.step_id in known:
            log.info("LLM matched %s to %s without a verifiable quote – ignored", filename, m.step_id)
    return out, parse_date(found.document_date or "")


def match_document(nodes: list[dict], *, doc_type: str, exam_type: str | None, filename: str,
                   title: str, excerpt: str) -> list[Fact]:
    """Return node_match facts for every evidence step this document fulfils."""
    return match(nodes, doc_type=doc_type, exam_type=exam_type, filename=filename, title=title, excerpt=excerpt)[0]


def _exam_types(node: dict) -> set[str]:
    return {t for r in node.get("requires") or [] if r.get("kind") == "exam"
            for t in ([r["exam_type"]] if isinstance(r.get("exam_type"), str) else r.get("exam_type") or [])}


def match(nodes: list[dict], *, doc_type: str, exam_type: str | None, filename: str, title: str, excerpt: str,
          reported: set[str] | frozenset = frozenset()) -> tuple[list[Fact], date | None]:
    """node_match facts for every evidence step this document fulfils, and the document's date as the LLM read it.

    `reported`: exam types whose result this document only quotes (the whole-document pass said so, e.g. the CT in a
    referral letter). A step that asks for one of those exams is not offered: this document is not that exam's report,
    so the model cannot contradict itself from one prompt wording to the next."""
    # every step that needs a document and accepts this file; "prior reports" is checked against the referral instead
    steps = [n for n in nodes if n.get("completion") == "evidence" and format_ok(n.get("accepted_formats"), filename)
             and not any(r.get("kind") == "mentioned_exams_received" for r in n.get("requires") or [])
             and not (_exam_types(n) and _exam_types(n) <= set(reported) and exam_type not in _exam_types(n))]
    facts: list[Fact] = []

    def add(node: dict, quote: str, method: str) -> None:
        facts.append(Fact(kind="node_match", key=node["id"],
                          props={"node_id": node["id"], "label": node.get("label") or _brief(node)[0]},
                          quote=quote, match="exact" if method == "rule" else "approx", method=method))

    ruled = [n for n in steps if _rule_match(n, doc_type, exam_type, filename, title)]
    for n in ruled:
        add(n, title or filename, "rule")
    by_llm, doc_date = _llm_matches(steps, doc_type=doc_type, exam_type=exam_type, filename=filename, title=title,
                                    text=excerpt) if steps and excerpt.strip() else ({}, None)
    for n in steps:
        if n["id"] in by_llm and n not in ruled:
            add(n, by_llm[n["id"]], "llm")
    return facts, doc_date
