"""Ollama-compatible bridge to the e-INFRA CZ LLM API (OpenAI-compatible), so the backend can use e-INFRA models
(glm-5.3-flash, qwen3.8-27b; embeddings qwen3-embedding-4b) instead of local Ollama without any code change.
Standalone: no other backend module imports it or is imported by it.

    uvicorn backend.einfra_bridge:app --port 11435
    # then run the backend with
    OLLAMA_URL=http://127.0.0.1:11435 LLM_MODEL=glm-5.3-flash EMBED_MODEL=qwen3-embedding-4b EMBED_DIM=2560

Implements what the backend calls: GET /api/tags, POST /api/chat (`format` JSON schema / "json" →
response_format; stream=true answers with Ollama's NDJSON chunks, reasoning as message.thinking when think=true),
POST /api/embed. Key: EINFRA_API_KEY or the file EINFRA_KEY_FILE (default
backend/einfracz.key, kept out of git by the root .gitignore rule `*.key`); never logged. The bridge does not read
backend/.env. Env: EINFRA_BASE_URL, EINFRA_MODELS (models listed by /api/tags).
"""
from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse

BASE_URL = os.getenv("EINFRA_BASE_URL", "https://llm.ai.e-infra.cz/v1")
KEY_FILE = Path(os.getenv("EINFRA_KEY_FILE", Path(__file__).with_name("einfracz.key")))
MODELS = [m.strip() for m in os.getenv("EINFRA_MODELS", "glm-5.3-flash,qwen3.8-27b,qwen3-embedding-4b").split(",") if m.strip()]
REASONING_HEADROOM = 4096  # these models spend reasoning tokens before the answer

app = FastAPI(title="Ollama → e-INFRA CZ bridge")


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _key() -> str:
    key = os.getenv("EINFRA_API_KEY") or (KEY_FILE.read_text(encoding="utf-8").strip() if KEY_FILE.is_file() else "")
    if not key:
        raise HTTPException(500, f"no e-INFRA API key: set EINFRA_API_KEY or create {KEY_FILE}")
    return key


async def _post(path: str, body: dict, timeout: float) -> dict:
    async with httpx.AsyncClient(timeout=timeout) as client:
        try:
            r = await client.post(f"{BASE_URL}{path}", json=body, headers={"Authorization": f"Bearer {_key()}"})
        except httpx.HTTPError as e:
            raise HTTPException(502, f"e-INFRA unreachable: {e}") from e
    if r.status_code != 200:
        raise HTTPException(r.status_code, f"e-INFRA: {r.text[:500]}")
    return r.json()


@app.get("/api/version")
def version() -> dict:
    return {"version": "einfra-bridge"}


@app.get("/api/tags")
def tags() -> dict:
    return {"models": [{"name": m, "model": m} for m in MODELS]}


@app.post("/api/chat")
async def chat(req: Request) -> dict:
    p = await req.json()
    opts = p.get("options") or {}
    body = {"model": p["model"], "messages": p["messages"], "temperature": opts.get("temperature", 0),
            "max_tokens": int(opts.get("num_predict") or 1024) + REASONING_HEADROOM}
    if "seed" in opts:
        body["seed"] = opts["seed"]
    fmt = p.get("format")
    if isinstance(fmt, dict):
        body["response_format"] = {"type": "json_schema", "json_schema": {"name": "output", "schema": fmt}}
    elif fmt == "json":
        body["response_format"] = {"type": "json_object"}
    if p.get("stream", True):  # Ollama streams unless told otherwise
        return StreamingResponse(_stream(p["model"], body, bool(p.get("think"))), media_type="application/x-ndjson")
    j = await _post("/chat/completions", body, 300)
    content = j["choices"][0]["message"].get("content") or ""
    content = re.sub(r"^\s*<think>.*?</think>\s*", "", content, flags=re.S)
    m = re.fullmatch(r"\s*```(?:json)?\s*(.*?)\s*```\s*", content, flags=re.S)
    u = j.get("usage") or {}
    return {"model": p["model"], "created_at": _now(), "done": True,
            "message": {"role": "assistant", "content": m.group(1) if m else content},
            "prompt_eval_count": u.get("prompt_tokens", 0), "eval_count": u.get("completion_tokens", 0)}


async def _stream(model: str, body: dict, think: bool):
    """e-INFRA server-sent events → Ollama NDJSON: one {"message": {"content": …}, "done": false} line per delta,
    then {"done": true, …counts}. A leading <think>…</think> block in the content is dropped."""
    def line(msg: dict, **extra) -> bytes:
        return (json.dumps({"model": model, "created_at": _now(), "message": {"role": "assistant", **msg}, **extra},
                           ensure_ascii=False) + "\n").encode()

    body = {**body, "stream": True, "stream_options": {"include_usage": True}}
    usage, buf, in_think = {}, "", None  # None = not decided yet whether the content starts with <think>
    try:
        async with httpx.AsyncClient(timeout=300) as client:
            async with client.stream("POST", f"{BASE_URL}/chat/completions", json=body,
                                     headers={"Authorization": f"Bearer {_key()}"}) as r:
                if r.status_code != 200:
                    yield line({"content": ""}, done=True, done_reason="error",
                               error=f"e-INFRA {r.status_code}: {(await r.aread()).decode(errors='replace')[:300]}")
                    return
                async for raw in r.aiter_lines():
                    if not raw.startswith("data:"):
                        continue
                    data = raw[5:].strip()
                    if data == "[DONE]":
                        break
                    chunk = json.loads(data)
                    usage = chunk.get("usage") or usage
                    if not chunk.get("choices"):
                        continue
                    delta = chunk["choices"][0].get("delta") or {}
                    reasoning = delta.get("reasoning_content") or delta.get("reasoning")
                    if think and reasoning:
                        yield line({"content": "", "thinking": reasoning}, done=False)
                    text = delta.get("content") or ""
                    if not text:
                        continue
                    if in_think is None:  # decide once enough content has arrived
                        buf += text
                        if not "<think>".startswith(buf.lstrip()[:7]) or len(buf.lstrip()) >= 7:
                            in_think = buf.lstrip().startswith("<think>")
                            text, buf = ("", buf) if in_think else (buf.lstrip(), "")
                        else:
                            continue
                    if in_think:
                        buf += text
                        if "</think>" not in buf:
                            continue
                        text, buf, in_think = buf.split("</think>", 1)[1].lstrip(), "", False
                    if text:
                        yield line({"content": text}, done=False)
    except httpx.HTTPError as e:
        yield line({"content": ""}, done=True, done_reason="error", error=f"e-INFRA unreachable: {e}")
        return
    if buf and not in_think:
        yield line({"content": buf}, done=False)
    yield line({"content": ""}, done=True, done_reason="stop",
               prompt_eval_count=usage.get("prompt_tokens", 0), eval_count=usage.get("completion_tokens", 0))


@app.post("/api/embed")
async def embed(req: Request) -> dict:
    p = await req.json()
    inputs = p["input"] if isinstance(p["input"], list) else [p["input"]]
    data = (await _post("/embeddings", {"model": p["model"], "input": inputs}, 120))["data"]
    return {"model": p["model"], "embeddings": [d["embedding"] for d in sorted(data, key=lambda d: d["index"])]}
