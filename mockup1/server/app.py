"""Small backend for the mockup1 prototype: serves the static prototype and scans uploaded documents with an LLM.

Run from mockup1/ (needs the repo venv: scripts/setup.sh, or pip install -r requirements.txt):

    ../.venv/bin/uvicorn server.app:app --port 8000      # then open http://localhost:8000/#/gp

POST /api/doc-scan     multipart: file (PDF/DOCX/TXT), items (JSON list of open pathway steps), models (comma list)
GET  /api/doc-scan/models
The API key is read from mockup1/einfracz.key (or EINFRA_API_KEY) and is never served.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from server import docscan

ROOT = Path(__file__).resolve().parent.parent  # mockup1/
MAX_BYTES = 15 * 1024 * 1024

app = FastAPI(title="mockup1 doc-scan", version="0.1")


@app.get("/api/doc-scan/models")
def models():
    return {"models": [{"id": k, "label": v} for k, v in docscan.MODELS.items()], "base_url": docscan.BASE_URL,
            "key": "configured" if (docscan.KEY_FILE.is_file() or os.getenv("EINFRA_API_KEY")) else "missing"}


@app.post("/api/doc-scan")
async def doc_scan(file: UploadFile = File(...), items: str = Form(...), models: str = Form("")):
    data = await file.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "soubor je větší než 15 MB")
    try:
        steps = json.loads(items)
        assert isinstance(steps, list) and all(isinstance(s, dict) and s.get("id") and s.get("label") for s in steps)
    except (json.JSONDecodeError, AssertionError):
        raise HTTPException(400, "items: očekávám JSON seznam {id, label, facts?}")
    if not steps:
        raise HTTPException(400, "items: není co hledat")
    chosen = [m for m in (models.split(",") if models else docscan.MODELS) if m]
    unknown = [m for m in chosen if m not in docscan.MODELS]
    if unknown:
        raise HTTPException(400, f"neznámý model: {', '.join(unknown)}")
    try:
        return await docscan.scan(file.filename or "dokument", data, steps, chosen)
    except ValueError as e:
        raise HTTPException(422, str(e))


# --- static prototype (same origin as the API) ---------------------------------------------------------------------

BLOCKED_SUFFIXES = {".key", ".env", ".pem", ".py", ".pyc"}


@app.get("/{path:path}")
def static(path: str):
    target = (ROOT / (path or "index.html")).resolve()
    if (ROOT not in target.parents and target != ROOT) or target.suffix in BLOCKED_SUFFIXES \
            or any(p.startswith(".") or p in ("server", "__pycache__") for p in target.relative_to(ROOT).parts):
        raise HTTPException(404)
    if target.is_dir():
        target = target / "index.html"
    if not target.is_file():
        raise HTTPException(404)
    return FileResponse(target)
