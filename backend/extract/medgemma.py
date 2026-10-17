"""MedGemma via Ollama: structured extraction (JSON schema) and short message drafting.

Every call is cached on disk (storage/llm_cache), keyed by model + prompt + schema, so re-runs and tests are
fast and repeatable. The model never decides anything: its output is verified against the source text and
shown to a human for confirmation.
"""
from __future__ import annotations

import hashlib
import json
import logging
from typing import TypeVar

import httpx
from pydantic import BaseModel, ValidationError

from backend.config import settings

log = logging.getLogger(__name__)
T = TypeVar("T", bound=BaseModel)

SYSTEM_EXTRACT = (
    "You are a clinical information extraction assistant for a Czech cancer centre. "
    "The input is one section of a Czech medical report. Return ONLY JSON that matches the schema. "
    "Rules: copy values verbatim in Czech exactly as written (do not translate, do not paraphrase); "
    "every 'quote' must be an exact substring of the input; never add information that is not in the input; "
    "if something is not present, return an empty list or null."
)


class LLMUnavailable(RuntimeError):
    pass


def _cache_path(payload: dict):
    key = hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    return settings.llm_cache_dir / f"{key}.json"


def _chat(messages: list[dict], fmt: dict | str | None, num_predict: int = 1024,
          temperature: float = 0, num_ctx: int = 4096, cache: bool = True) -> str:
    payload = {
        "model": settings.medgemma_model,
        "messages": messages,
        "stream": False,
        "think": False,
        "options": {"temperature": temperature, "num_ctx": num_ctx, "num_predict": num_predict, "seed": 7},
    }
    if fmt is not None:
        payload["format"] = fmt  # Ollama: JSON schema dict, or the string "json"
    path = _cache_path(payload)
    if cache and path.exists():
        return json.loads(path.read_text(encoding="utf-8"))["content"]
    try:
        r = httpx.post(f"{settings.ollama_url}/api/chat", json=payload, timeout=300)
        r.raise_for_status()
    except httpx.HTTPError as e:
        raise LLMUnavailable(f"Ollama/{settings.medgemma_model}: {e}") from e
    content = r.json()["message"]["content"]
    if cache:
        path.write_text(json.dumps({"content": content, "model": settings.medgemma_model}, ensure_ascii=False),
                        encoding="utf-8")
    return content


def extract(schema: type[T], instruction: str, text: str) -> T:
    """Structured extraction. Raises LLMUnavailable if Ollama is down; returns an empty model on bad JSON."""
    messages = [
        {"role": "system", "content": SYSTEM_EXTRACT},
        {"role": "user", "content": f"{instruction}\n\n--- INPUT (Czech) ---\n{text}\n--- END INPUT ---"},
    ]
    raw = _chat(messages, schema.model_json_schema(), num_predict=2048)
    try:
        return schema.model_validate_json(raw)
    except ValidationError as e:
        salvaged = _salvage(raw, schema)
        if salvaged is not None:
            return salvaged
        log.warning("MedGemma returned JSON that does not fit %s: %s", schema.__name__, str(e)[:300])
        try:
            return schema()
        except ValidationError:
            raise LLMUnavailable(f"MedGemma output did not match {schema.__name__}") from e


def _salvage(raw: str, schema: type[T]) -> T | None:
    """Truncated output: keep the complete list items before the cut."""
    for end in range(len(raw) - 1, 0, -1):
        if raw[end] != "}":
            continue
        try:
            return schema.model_validate_json(raw[: end + 1] + "]}")
        except ValidationError:
            continue
    return None


def _json_object(raw: str) -> str:
    cleaned = (raw or "").strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[-1]
        if cleaned.endswith("```"):
            cleaned = cleaned[: cleaned.rfind("```")].strip()
    start, end = cleaned.find("{"), cleaned.rfind("}")
    if start >= 0 and end > start:
        return cleaned[start: end + 1]
    return cleaned


def complete_json(system: str, user: str, *, num_predict: int = 2200,
                  temperature: float = 0.3, num_ctx: int = 4096) -> dict:
    """Raw JSON object from the model. Does not cache. Raises LLMUnavailable on empty/invalid JSON."""
    raw = _chat(
        [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "json", num_predict=num_predict, temperature=temperature, num_ctx=num_ctx, cache=False,
    )
    cleaned = _json_object(raw)
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError as e:
        log.warning("LLM JSON parse failed: %s | raw=%s", e, cleaned[:240])
        raise LLMUnavailable("the model did not return JSON") from e
    if not isinstance(data, dict):
        raise LLMUnavailable("the model did not return a JSON object")
    return data


def complete(system: str, user: str, schema: type[T], *, num_predict: int = 1800,
             temperature: float = 0.2, num_ctx: int = 4096, use_schema: bool = False) -> T:
    """Structured generation (pathway drafts etc.). Raises LLMUnavailable if Ollama is down or JSON is empty."""
    fmt: dict | str | None = schema.model_json_schema() if use_schema else "json"
    raw = _chat(
        [{"role": "system", "content": system}, {"role": "user", "content": user}],
        fmt, num_predict=num_predict, temperature=temperature, num_ctx=num_ctx, cache=False,
    )
    cleaned = _json_object(raw)
    try:
        return schema.model_validate_json(cleaned)
    except ValidationError as e:
        salvaged = _salvage(cleaned, schema)
        if salvaged is not None:
            return salvaged
        try:
            return schema.model_validate(json.loads(cleaned))
        except (json.JSONDecodeError, ValidationError):
            pass
        log.warning("LLM JSON did not fit %s: %s | raw=%s", schema.__name__, str(e)[:200], cleaned[:240])
        raise LLMUnavailable(f"the model did not return a usable {schema.__name__}") from e


def write(instruction: str, facts: str, max_tokens: int = 400) -> str:
    """Draft a short human-readable message. Facts come from the caller; the model only phrases them."""
    messages = [
        {"role": "system", "content": (
            "You draft short, polite, professional messages in Czech for a cancer-care coordinator. "
            "Use ONLY the facts given. Do not add medical facts, dates or names that are not given. "
            "Plain text, no markdown, no placeholders.")},
        {"role": "user", "content": f"{instruction}\n\nFACTS:\n{facts}"},
    ]
    return _chat(messages, None, num_predict=max_tokens).strip()


def available() -> bool:
    try:
        tags = httpx.get(f"{settings.ollama_url}/api/tags", timeout=3).json()
        base = settings.medgemma_model.split(":")[0]
        return any(m["name"].split(":")[0] == base for m in tags.get("models", []))
    except httpx.HTTPError:
        return False
