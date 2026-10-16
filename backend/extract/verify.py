"""Check that a quote returned by the model really occurs in the source text.

exact  – the quote is a substring of the source (after folding case/diacritics/whitespace)
approx – every word of the quote occurs, in order, within a short window of the source
None   – not found → shown as "unverified" and must be checked by a human
"""
from __future__ import annotations

import re

from backend.ingest.reader import fold


def _norm(s: str) -> str:
    s = fold(s)
    s = s.replace("–", "-").replace("—", "-").replace("×", "x")
    return re.sub(r"\s+", " ", s).strip(" .,;:")


def _words(s: str) -> list[str]:
    return re.findall(r"[\w\-/]+", _norm(s))


def quote_match(quote: str | None, source: str) -> str | None:
    if not quote or len(quote.strip()) < 3:
        return None
    if _norm(quote) in _norm(source):
        return "exact"
    q, src = _words(quote), _words(source)
    if not q:
        return None
    window = len(q) * 3 + 4
    for start, w in enumerate(src):
        if w != q[0]:
            continue
        i = 0
        for token in src[start:start + window]:
            if token == q[i]:
                i += 1
                if i == len(q):
                    return "approx"
    return None


def quote_in(quote: str | None, source: str) -> bool:
    return quote_match(quote, source) is not None
