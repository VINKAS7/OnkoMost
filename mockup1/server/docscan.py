"""Scan an uploaded document (PDF / DOCX / TXT) for steps of the diagnostic pathway that a case is still missing.

The browser sends the open pathway steps (id, label, the facts each step produces); an LLM on the e-INFRA CZ
OpenAI-compatible endpoint answers which of them the document documents, with a verbatim quote and the fact values.
Every answer is then checked here: unknown ids are dropped, fact values must match the pathway's fact type, and the
quote must really occur in the document text ("verified"). The result is only a draft; the doctor confirms each item.

CLI (from mockup1/):  ../.venv/bin/python -m server.docscan data/demo/ambulantni-zprava-novak.pdf \
                          --steps prior_reports,bloods,ca19_9,performance_status,ct_pancreas,histology --runs 3
"""
from __future__ import annotations

import argparse
import asyncio
import io
import json
import os
import re
import sys
import time
import unicodedata
from pathlib import Path

import httpx

HERE = Path(__file__).resolve().parent
BASE_URL = os.getenv("EINFRA_BASE_URL", "https://llm.ai.e-infra.cz/v1")
KEY_FILE = Path(os.getenv("EINFRA_KEY_FILE", HERE.parent / "einfracz.key"))
MODELS = {  # id on the endpoint → label in the UI
    "glm-5.3-flash": "GLM-5.3-flash",
    "qwen3.8-27b": "Qwen3.8-27B",
}
MAX_CHARS = 30_000
TIMEOUT = float(os.getenv("DOCSCAN_TIMEOUT", "240"))


def api_key() -> str:
    key = os.getenv("EINFRA_API_KEY") or (KEY_FILE.read_text(encoding="utf-8").strip() if KEY_FILE.is_file() else "")
    if not key:
        raise RuntimeError(f"no API key: set EINFRA_API_KEY or create {KEY_FILE}")
    return key


# --- text extraction ---------------------------------------------------------------------------------------------

def extract_text(name: str, data: bytes) -> tuple[str, dict]:
    """Plain text of the document and metadata ({kind, pages, chars})."""
    ext = Path(name).suffix.lower()
    if ext == ".pdf":
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(data))
        pages = [(p.extract_text() or "").strip() for p in reader.pages]
        text = "\n\n".join(f"[strana {i}]\n{t}" for i, t in enumerate(pages, 1))
        meta = {"kind": "pdf", "pages": len(pages)}
        if not any(pages):
            raise ValueError("PDF nemá textovou vrstvu (sken) – OCR prototyp zatím neumí")
    elif ext == ".docx":
        import docx
        from docx.table import Table
        from docx.text.paragraph import Paragraph
        d = docx.Document(io.BytesIO(data))
        parts = []
        for el in d.element.body.iterchildren():  # paragraphs and tables in document order
            if el.tag.endswith("}p"):
                t = Paragraph(el, d).text
                if t.strip():
                    parts.append(t)
            elif el.tag.endswith("}tbl"):
                for row in Table(el, d).rows:
                    cells = [c.text.strip() for c in row.cells]
                    parts.append(" | ".join(dict.fromkeys(cells)))  # merged cells repeat; keep each once
        text, meta = "\n".join(parts), {"kind": "docx", "pages": None}
    elif ext in (".txt", ".md"):
        text, meta = data.decode("utf-8", errors="replace"), {"kind": "text", "pages": None}
    else:
        raise ValueError(f"nepodporovaný typ souboru {ext or name} (PDF, DOCX, TXT)")
    text = text.strip()
    meta["chars"] = len(text)
    meta["truncated"] = len(text) > MAX_CHARS
    return text[:MAX_CHARS], meta


# --- prompt ------------------------------------------------------------------------------------------------------

SYSTEM = """You check Czech oncology referral documents for a cancer centre (KOC).
You get the text of ONE uploaded document and a list of diagnostic-pathway steps that are still MISSING for this patient.
For every step decide whether THIS document documents it, i.e. contains an actual result, finding or assessment
for that step (a measured value, a performed examination with its result, an explicit assessment).
NOT found: a plan, an order or referral ("objednáno", "doporučeno", "k doplnění"), a statement that it was not done
or is not available ("neprovedeno", "není k dispozici"), or a mere mention of the word.
Rules:
- Use only the document. Never guess or infer values that are not written there.
- "quote": copy a short passage (max ~200 characters) VERBATIM from the document that proves the finding; null if not found.
- "value": a short Czech summary of what the document says for that step (e.g. "ECOG 1", "CA 19-9 389 kU/l (5. 1. 2026)"); null if not found.
- "facts": values of the listed facts of that step, only when the document states them explicitly; types: bool true/false,
  number (no unit), enum (one of the listed values). Omit facts that are not stated.
- Answer every step id exactly once, in the given order.
Reply with JSON only:
{"document": {"type": "<short Czech document type>", "date": "YYYY-MM-DD or null", "author": "<facility / doctor or null>"},
 "items": [{"id": "<step id>", "found": true|false, "value": "...", "quote": "...", "facts": {"<fact>": <value>}}]}"""


def user_prompt(items: list[dict], text: str) -> str:
    lines = []
    for it in items:
        facts = "; ".join(
            f"{f['name']} ({f.get('type', 'text')}{', ' + f['unit'] if f.get('unit') else ''}"
            f"{', values: ' + '/'.join(map(str, f['values'])) if f.get('values') else ''}) – {f.get('label', '')}"
            for f in it.get("facts", []))
        desc = f" – {it['description']}" if it.get("description") else ""
        lines.append(f"- id: {it['id']} | {it['label']}{desc}" + (f"\n  facts: {facts}" if facts else ""))
    return f"MISSING STEPS:\n" + "\n".join(lines) + f"\n\nDOCUMENT TEXT:\n<<<\n{text}\n>>>"


# --- validation --------------------------------------------------------------------------------------------------

def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKC", s).lower()
    s = re.sub(r"[‐‑‒–—−]", "-", s).replace("“", '"').replace("”", '"').replace("„", '"')
    return re.sub(r"\s+", " ", s).strip()


def _verified(quote: str | None, text_norm: str) -> bool:
    if not quote:
        return False
    q = _norm(quote).strip(" .…\"'")
    if len(q) < 4:
        return False
    if q in text_norm:
        return True
    # tolerate an ellipsis inside the quote: every fragment must be present, in order
    parts = [p.strip() for p in re.split(r"\.\.\.|…", q) if len(p.strip()) >= 4]
    pos = 0
    for p in parts or [q]:
        i = text_norm.find(p, pos)
        if i < 0:
            return False
        pos = i + len(p)
    return True


def _coerce(v, fdef: dict):
    t = fdef.get("type")
    if t == "bool":
        if isinstance(v, bool):
            return v
        if str(v).strip().lower() in ("true", "ano", "yes", "1"):
            return True
        if str(v).strip().lower() in ("false", "ne", "no", "0"):
            return False
        return None
    if t == "number":
        if isinstance(v, bool):
            return None
        if isinstance(v, (int, float)):
            return v
        m = re.search(r"-?\d+(?:[.,]\d+)?", str(v))
        if not m:
            return None
        n = float(m.group().replace(",", "."))
        return int(n) if n.is_integer() else n
    if t == "enum":
        return v if v in (fdef.get("values") or []) else None
    return v if isinstance(v, (str, int, float, bool)) else None


def parse_json(content: str) -> dict:
    s = (content or "").strip()
    s = re.sub(r"^```(?:json)?\s*|\s*```$", "", s)
    try:
        return json.loads(s)
    except json.JSONDecodeError:
        a, b = s.find("{"), s.rfind("}")
        if a >= 0 and b > a:
            return json.loads(s[a:b + 1])
        raise


def validate(raw: dict, items: list[dict], text: str) -> dict:
    text_norm = _norm(text)
    by_id = {it["id"]: it for it in items}
    got = {}
    for r in raw.get("items") or []:
        if isinstance(r, dict) and r.get("id") in by_id and r["id"] not in got:
            got[r["id"]] = r
    out = []
    for it in items:
        r = got.get(it["id"], {})
        found = bool(r.get("found"))
        fdefs = {f["name"]: f for f in it.get("facts", [])}
        facts, dropped = {}, []
        for k, v in (r.get("facts") or {}).items() if found and isinstance(r.get("facts"), dict) else []:
            c = _coerce(v, fdefs[k]) if k in fdefs else None
            if c is None:
                dropped.append(k)
            else:
                facts[k] = c
        quote = r.get("quote") if found and isinstance(r.get("quote"), str) else None
        out.append({
            "id": it["id"], "found": found, "answered": it["id"] in got,
            "value": (r.get("value") if found and isinstance(r.get("value"), str) else None),
            "quote": quote, "verified": found and _verified(quote, text_norm),
            "facts": facts, "dropped_facts": dropped,
        })
    doc = raw.get("document") if isinstance(raw.get("document"), dict) else {}
    return {"document": {k: doc.get(k) for k in ("type", "date", "author")}, "items": out}


# --- LLM call ----------------------------------------------------------------------------------------------------

async def scan_with(client: httpx.AsyncClient, model: str, items: list[dict], text: str) -> dict:
    t0 = time.perf_counter()
    res = {"model": model, "label": MODELS.get(model, model)}
    try:
        r = await client.post(f"{BASE_URL}/chat/completions", json={
            "model": model, "temperature": 0, "response_format": {"type": "json_object"},
            "messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user_prompt(items, text)}],
        }, headers={"Authorization": f"Bearer {api_key()}"}, timeout=TIMEOUT)
        r.raise_for_status()
        j = r.json()
        content = j["choices"][0]["message"].get("content") or ""
        res.update(validate(parse_json(content), items, text))
        u = j.get("usage") or {}
        res["usage"] = {"prompt": u.get("prompt_tokens"), "completion": u.get("completion_tokens"),
                        "reasoning": (u.get("completion_tokens_details") or {}).get("reasoning_tokens")}
    except httpx.HTTPStatusError as e:
        res["error"] = f"HTTP {e.response.status_code}: {e.response.text[:300]}"
    except (httpx.HTTPError, json.JSONDecodeError, KeyError, RuntimeError) as e:
        res["error"] = f"{type(e).__name__}: {e}"[:400]
    res["ms"] = round((time.perf_counter() - t0) * 1000)
    return res


async def scan(name: str, data: bytes, items: list[dict], models: list[str]) -> dict:
    text, meta = extract_text(name, data)
    async with httpx.AsyncClient() as client:
        results = await asyncio.gather(*(scan_with(client, m, items, text) for m in models))
    return {"file": {"name": name, **meta}, "excerpt": text[:1200], "items": items, "results": results}


# --- CLI: repeatable model comparison ----------------------------------------------------------------------------

def items_from_pathway(pathway: dict, step_ids: list[str]) -> list[dict]:
    nodes = {n["id"]: n for n in pathway["graph"]["nodes"]}
    facts = pathway.get("facts") or {}
    out = []
    for sid in step_ids:
        n = nodes[sid]
        out.append({"id": sid, "label": n["label"], "description": n.get("description"),
                    "facts": [{"name": f, **{k: facts[f][k] for k in ("type", "label", "unit", "values") if k in facts[f]}}
                              for f in n.get("produces") or [] if f in facts and not facts[f].get("derived")]})
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python -m server.docscan", description="Compare models on one document.")
    ap.add_argument("file", type=Path)
    ap.add_argument("--pathway", type=Path, default=HERE.parent / "data" / "dx-pathway-pancreas.json")
    ap.add_argument("--steps", required=True, help="comma-separated pathway step ids")
    ap.add_argument("--models", default=",".join(MODELS))
    ap.add_argument("--runs", type=int, default=1)
    ap.add_argument("--json", type=Path, help="write all raw results here")
    a = ap.parse_args(argv)
    items = items_from_pathway(json.loads(a.pathway.read_text(encoding="utf-8")), a.steps.split(","))
    models = a.models.split(",")
    runs = []
    for i in range(a.runs):
        r = asyncio.run(scan(a.file.name, a.file.read_bytes(), items, models))
        runs.append(r)
        for res in r["results"]:
            if res.get("error"):
                print(f"run {i + 1} {res['label']:<14} ERROR {res['error']}")
                continue
            hits = " ".join(f"{x['id']}{'✓' if x['verified'] else '?'}" + (f"{x['facts']}" if x["facts"] else "")
                            for x in res["items"] if x["found"])
            print(f"run {i + 1} {res['label']:<14} {res['ms'] / 1000:5.1f}s  tok {res['usage']['completion']:>5}  {hits}")
    if a.json:
        a.json.write_text(json.dumps(runs, ensure_ascii=False, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
