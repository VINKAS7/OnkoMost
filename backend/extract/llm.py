"""The LLM (LLM_MODEL, by default deepseek-v4.1-flash on e-INFRA CZ) behind an OpenAI-compatible API: structured
extraction (JSON schema), RAG answers and short message drafting. post() is also used for embeddings and reranking.

Every call is cached on disk (storage/llm_cache), keyed by model + prompt + schema, so re-runs and tests are
fast and repeatable. The model never decides anything: its output is verified against the source text and
shown to a human for confirmation.
"""
from __future__ import annotations

import hashlib
import json
import logging
import time
from typing import TypeVar

import httpx
from pydantic import BaseModel, ValidationError

from backend.config import settings

log = logging.getLogger(__name__)
T = TypeVar("T", bound=BaseModel)
RETRIES = 3  # a shared service answers 429 / 5xx under load – try again before giving up

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


def post(path: str, payload: dict, timeout: float = 300) -> dict:
    """POST to the OpenAI-compatible API (LLM_BASE_URL + path). Retries 429 / 5xx / network errors with backoff."""
    headers = {"Authorization": f"Bearer {settings.llm_api_key}"} if settings.llm_api_key else {}
    for attempt in range(RETRIES):
        try:
            r = httpx.post(f"{settings.llm_base_url}{path}", json=payload, headers=headers, timeout=timeout)
            if r.status_code == 429 or r.status_code >= 500:
                raise httpx.HTTPStatusError(f"{r.status_code}: {r.text[:200]}", request=r.request, response=r)
            r.raise_for_status()
            return r.json()
        except httpx.HTTPStatusError as e:
            if (e.response.status_code < 500 and e.response.status_code != 429) or attempt == RETRIES - 1:
                raise LLMUnavailable(f"{settings.llm_base_url}{path}: {e.response.status_code} {e.response.text[:200]}") from e
        except (httpx.HTTPError, ValueError) as e:
            if attempt == RETRIES - 1:
                raise LLMUnavailable(f"{settings.llm_base_url}{path}: {e}") from e
        time.sleep(2 ** attempt)
    raise LLMUnavailable(f"{settings.llm_base_url}{path}: no answer")


def _chat(messages: list[dict], fmt: dict | str | None, max_tokens: int = 1024, temperature: float = 0,
          cache: bool = True, name: str = "Answer") -> str:
    payload = {"model": settings.llm_model, "messages": messages, "temperature": temperature,
               "max_tokens": max_tokens, "seed": 7}
    if settings.llm_reasoning_effort:
        payload["reasoning_effort"] = settings.llm_reasoning_effort
    if isinstance(fmt, dict):  # a JSON schema: the server constrains the output to it
        payload["response_format"] = {"type": "json_schema", "json_schema": {"name": name, "schema": fmt}}
    elif fmt == "json":
        payload["response_format"] = {"type": "json_object"}
    path = _cache_path(payload)
    if cache and path.exists():
        return json.loads(path.read_text(encoding="utf-8"))["content"]
    data = post("/chat/completions", payload)
    try:
        content = data["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError, TypeError) as e:
        raise LLMUnavailable(f"{settings.llm_model}: unexpected answer {str(data)[:200]}") from e
    if cache and content:
        path.write_text(json.dumps({"content": content, "model": settings.llm_model}, ensure_ascii=False),
                        encoding="utf-8")
    return content


def extract(schema: type[T], instruction: str, text: str, max_tokens: int = 2048) -> T:
    """Structured extraction. Raises LLMUnavailable if the LLM is unreachable; returns an empty model on bad JSON.
    The schema goes into the prompt too: the server enforces its shape, the field descriptions tell the model what
    belongs in each field."""
    json_schema = schema.model_json_schema()
    messages = [
        {"role": "system", "content": f"{SYSTEM_EXTRACT}\nJSON schema:\n{json.dumps(json_schema, ensure_ascii=False)}"},
        {"role": "user", "content": f"{instruction}\n\n--- INPUT (Czech) ---\n{text}\n--- END INPUT ---"},
    ]
    raw = _chat(messages, json_schema, max_tokens=max_tokens, name=schema.__name__)
    try:
        return schema.model_validate_json(raw)
    except ValidationError as e:
        salvaged = _salvage(raw, schema)
        if salvaged is not None:
            return salvaged
        log.warning("The LLM returned JSON that does not fit %s: %s", schema.__name__, str(e)[:300])
        try:
            return schema()
        except ValidationError:
            raise LLMUnavailable(f"LLM output did not match {schema.__name__}") from e


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


def complete_json(system: str, user: str, *, max_tokens: int = 2200, temperature: float = 0.3) -> dict:
    """Raw JSON object from the model. Does not cache. Raises LLMUnavailable on empty/invalid JSON."""
    raw = _chat(
        [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "json", max_tokens=max_tokens, temperature=temperature, cache=False,
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


def complete(system: str, user: str, schema: type[T], *, max_tokens: int = 1800,
             temperature: float = 0.2, use_schema: bool = False) -> T:
    """Structured generation (pathway drafts etc.). Raises LLMUnavailable if the LLM is unreachable or JSON is empty."""
    fmt: dict | str | None = schema.model_json_schema() if use_schema else "json"
    raw = _chat(
        [{"role": "system", "content": system}, {"role": "user", "content": user}],
        fmt, max_tokens=max_tokens, temperature=temperature, cache=False, name=schema.__name__,
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
    return _chat(messages, None, max_tokens=max_tokens).strip()


_available: tuple[float, bool] = (0.0, False)


def available() -> bool:
    """Is LLM_MODEL listed by the API? Cached for a minute – the UI asks on every page."""
    global _available
    if time.time() - _available[0] < 60:
        return _available[1]
    headers = {"Authorization": f"Bearer {settings.llm_api_key}"} if settings.llm_api_key else {}
    try:
        models = httpx.get(f"{settings.llm_base_url}/models", headers=headers, timeout=5).json().get("data", [])
        ok = any(m.get("id") == settings.llm_model for m in models)
    except (httpx.HTTPError, ValueError, AttributeError):
        ok = False
    _available = (time.time(), ok)
    return ok
