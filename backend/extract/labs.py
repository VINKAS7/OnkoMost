"""Lab tables → structured results. Deterministic: no LLM touches numbers."""
from __future__ import annotations

import re

from backend.ingest.reader import DocText, fold

TUMOR_MARKERS = {"ca 19-9", "cea", "ca 125", "afp", "psa", "ca 15-3", "ca 72-4", "cyfra 21-1", "nse", "scc"}


def _num(s: str) -> float | None:
    m = re.match(r"^\s*[<>]?\s*(-?\d+(?:[.,]\d+)?)", s)
    return float(m.group(1).replace(",", ".")) if m else None


def parse_labs(doc: DocText) -> list[dict]:
    out: list[dict] = []
    for panel, rows in doc.tables():
        if not rows:
            continue
        header = [fold(c) for c in rows[0]]
        if "vysledek" not in header:
            continue
        i_name, i_val = 0, header.index("vysledek")
        i_unit = header.index("jednotky") if "jednotky" in header else None
        i_ref = next((i for i, h in enumerate(header) if h.startswith("ref")), None)
        for r in rows[1:]:
            if len(r) <= i_val or not r[i_name].strip():
                continue
            raw = r[i_val].strip()
            flag = None
            m = re.match(r"^(.*?)\s+([HL])$", raw)
            if m:
                raw, flag = m.group(1).strip(), m.group(2)
            analyte = r[i_name].strip()
            out.append({
                "analyte": analyte,
                "value": raw,
                "value_num": _num(raw),
                "unit": (r[i_unit].strip() if i_unit is not None and i_unit < len(r) else ""),
                "ref": (r[i_ref].strip() if i_ref is not None and i_ref < len(r) else ""),
                "flag": flag,
                "panel": panel,
                "is_tumor_marker": fold(analyte) in TUMOR_MARKERS or "nadorove" in fold(panel),
                "quote": " | ".join(c for c in r if c),
            })
    # Microbiology culture result is a paragraph right after the "KULTIVACE" heading.
    for head, text in doc.sections.items():
        if "kultivace" in fold(head) and text:
            first = text.splitlines()[0]
            out.append({"analyte": "Kultivace moči", "value": first, "value_num": None, "unit": "", "ref": "",
                        "flag": None, "panel": head, "is_tumor_marker": False, "quote": first})
    return out


def abnormal_summary(labs: list[dict]) -> str:
    parts = [f"{l['analyte']} {l['value']}{(' ' + l['unit']) if l['unit'] else ''} {l['flag']}"
             for l in labs if l["flag"]]
    return ", ".join(parts)
