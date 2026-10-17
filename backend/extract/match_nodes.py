"""Decide whether an uploaded document fulfills a pathway document-step.

Uses the step's title + description (what the coordinator wrote) and the allowed file formats.
A rule check runs first. The LLM is asked, with the step's title + description as its brief, when the rule is unsure
and either the step lists a `described` requirement (it has no machine-readable test, e.g. "lung function tests"),
or the parser could not classify the document (doc_type "other"). A document the parser did classify (a CT, a lab
report…) is never re-judged by the LLM for a step that asks for a different exam – that is where a small model
produced false positives.
"""
from __future__ import annotations

import logging
import re

from backend.extract import llm
from backend.extract.pipeline import Fact
from backend.extract.schemas import NodeFit
from backend.extract.verify import quote_match
from backend.ingest.reader import fold
from backend.pathway.formats import format_ok

log = logging.getLogger(__name__)

_INSTRUCTION = (
    "A cancer-pathway step needs the evidence its title and description ask for. Read them, then the document "
    "(type, file name, title, excerpt). Return matches=true ONLY if this document itself contains that evidence – "
    "the actual result or report, as the description defines it. A document that only says the exam was done, is "
    "planned or was requested does not count, unless the description says it does. quote must be an exact "
    "substring of the document text that proves it."
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
    if not format_ok(node.get("accepted_formats"), filename):
        return False
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


def match_document(nodes: list[dict], *, doc_type: str, exam_type: str | None, filename: str,
                   title: str, excerpt: str) -> list[Fact]:
    """Return node_match facts for every evidence step this document fulfills."""
    facts: list[Fact] = []
    for node in nodes:
        if node.get("completion") != "evidence":
            continue
        if not format_ok(node.get("accepted_formats"), filename):
            continue
        title_n, desc = _brief(node)
        hit = _rule_match(node, doc_type, exam_type, filename, title)
        method, quote = "rule", title or filename
        described = any(r.get("kind") == "described" for r in node.get("requires") or [])
        unclassified = doc_type == "other" and not exam_type
        if not hit and desc and (described or unclassified):
            try:
                fit = llm.extract(NodeFit, _INSTRUCTION,
                                       f"STEP TITLE: {title_n}\nSTEP DESCRIPTION: {desc}\n"
                                       f"ALLOWED FORMATS: {', '.join(node.get('accepted_formats') or ['any'])}\n"
                                       f"DOCUMENT TYPE: {doc_type}\nEXAM: {exam_type or '—'}\n"
                                       f"FILE: {filename}\nDOCUMENT TITLE: {title}\n\n--- DOCUMENT ---\n{excerpt[:2500]}")
                qm = quote_match(fit.quote, excerpt) if fit.quote else None
                if fit.matches and (qm or not excerpt.strip()):
                    hit, method, quote = True, "llm", (fit.quote or title)[:300]
            except llm.LLMUnavailable:
                log.info("skip LLM node match for %s: model offline", node.get("id"))
        if hit:
            facts.append(Fact(kind="node_match", key=node["id"],
                              props={"node_id": node["id"], "label": node.get("label") or title_n},
                              quote=quote, match="exact" if method == "rule" else "approx", method=method))
    return facts
