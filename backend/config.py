"""Settings loaded from backend/.env. Run `python -m backend.config --check` from the repo root."""
from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / "backend" / ".env")


def _sqlite_url(raw: str) -> str:
    # Relative sqlite paths are resolved against the repo root, not the cwd.
    prefix = "sqlite:///"
    if raw.startswith(prefix):
        path = Path(raw[len(prefix):])
        if not path.is_absolute():
            path = ROOT / path
        path.parent.mkdir(parents=True, exist_ok=True)
        return prefix + path.as_posix()
    return raw


@dataclass(frozen=True)
class Settings:
    # InterSystems IRIS for Health (infra/iris): patient graph in globals, document chunks in a SQL vector table,
    # and the FHIR R4 server that holds the patient-identifying data.
    iris_host: str = os.getenv("IRIS_HOST", "localhost")
    iris_port: int = int(os.getenv("IRIS_PORT", "1972"))
    iris_web_port: int = int(os.getenv("IRIS_WEB_PORT", "52773"))
    iris_namespace: str = os.getenv("IRIS_NAMESPACE", "ONKOMOST")
    iris_user: str = os.getenv("IRIS_USER", "_SYSTEM")
    iris_password: str = os.getenv("IRIS_PASSWORD", "SYS")
    fhir_path: str = os.getenv("FHIR_PATH", "/fhir/r4")
    # Any OpenAI-compatible API (/chat/completions, /embeddings, /rerank): e-INFRA CZ by default, or a local
    # Ollama at http://localhost:11434/v1 (no key, no reranker).
    llm_base_url: str = os.getenv("LLM_BASE_URL", "https://llm.ai.e-infra.cz/v1").rstrip("/")
    llm_api_key: str = os.getenv("LLM_API_KEY", "")
    # RAG synthesis + extraction model. LLM_REASONING_EFFORT is sent as reasoning_effort for reasoning models
    # ("none" = answer directly: fast, and JSON is not cut off by a long chain of thought); empty = not sent.
    llm_model: str = os.getenv("LLM_MODEL") or "deepseek-v4.1-flash"
    llm_reasoning_effort: str = os.getenv("LLM_REASONING_EFFORT", "none")
    # First-stage dense retrieval for the GraphRAG vector leg; empty = keyword search only.
    # EMBED_DIM is the size of the VECTOR column and must match the model's output.
    embed_model: str = os.getenv("EMBED_MODEL", "qwen3-embedding-4b")
    embed_dim: int = int(os.getenv("EMBED_DIM", "2560"))
    # Second-stage reranking of the fused candidates; empty = keep the fusion order.
    rerank_model: str = os.getenv("RERANK_MODEL", "qwen3-reranker-4b")
    sqlite_url: str = _sqlite_url(os.getenv("SQLITE_URL", "sqlite:///backend/data/onkomost.sqlite3"))
    sample_data_dir: Path = Path(os.getenv("SAMPLE_DATA_DIR", str(ROOT / "sample")))
    raw_dir: Path = ROOT / "storage" / "raw"
    llm_cache_dir: Path = ROOT / "storage" / "llm_cache"
    docling_models_dir: Path = Path(os.getenv("DOCLING_MODELS_DIR") or ROOT / "storage" / "docling-models")
    reports_dir: Path = ROOT / "storage" / "reports"


    @property
    def fhir_base_url(self) -> str:
        return os.getenv("FHIR_BASE_URL") or f"http://{self.iris_host}:{self.iris_web_port}{self.fhir_path}"


settings = Settings()
for _d in (settings.raw_dir, settings.llm_cache_dir, settings.reports_dir):
    _d.mkdir(parents=True, exist_ok=True)


def check() -> bool:
    ok = True
    try:
        from backend.graph.store import graph
        info = graph.ping()
        print(f"[ok]   IRIS {settings.iris_host}:{settings.iris_port}/{settings.iris_namespace} – {info}")
    except Exception as e:  # noqa: BLE001
        ok = False
        print(f"[FAIL] IRIS {settings.iris_host}:{settings.iris_port}/{settings.iris_namespace}: {e}")
    try:
        from backend.fhir.client import fhir
        print(f"[ok]   FHIR {settings.fhir_base_url} – {fhir.ping()}")
    except Exception as e:  # noqa: BLE001
        ok = False
        print(f"[FAIL] FHIR {settings.fhir_base_url}: {e}")
    models = settings.docling_models_dir
    try:
        import docling  # noqa: F401
        if (models / "EasyOcr").is_dir():
            print(f"[ok]   Docling: models in {models}")
        else:
            print(f"[warn] Docling: models not downloaded yet – the first document downloads them into {models} (~800 MB)")
    except ImportError as e:
        ok = False
        print(f"[FAIL] Docling is not installed (pip install -r requirements.txt): {e}")
    from backend.extract import llm
    try:
        reply = llm.write("Odpověz jedním slovem: funguješ?", "-", max_tokens=10)
        print(f"[ok]   LLM {settings.llm_model} at {settings.llm_base_url} – {reply[:40]!r}")
    except llm.LLMUnavailable as e:
        ok = False
        print(f"[FAIL] LLM {settings.llm_model} at {settings.llm_base_url}: {e} (LLM_BASE_URL / LLM_API_KEY / LLM_MODEL)")
    from backend.rag import index
    if settings.embed_model:
        if index.embed(["test"], "passage"):
            print(f"[ok]   Embeddings {settings.embed_model} ({settings.embed_dim} dims)")
        else:
            ok = False
            print(f"[FAIL] Embeddings {settings.embed_model}: unreachable or not {settings.embed_dim} dims (see EMBED_DIM)")
    else:
        print("[warn] EMBED_MODEL is empty: GraphRAG uses keyword search only")
    if settings.rerank_model:
        scores = index.rerank("Jaká je hodnota CA 19-9?", ["CA 19-9 312 kU/l", "Sinusový rytmus, apixaban 5 mg"])
        if scores and scores[0] > scores[1]:
            print(f"[ok]   Reranker {settings.rerank_model} – {scores[0]:.2f} vs {scores[1]:.2f}")
        else:
            ok = False
            print(f"[FAIL] Reranker {settings.rerank_model}: {'unreachable' if scores is None else f'wrong order {scores}'}")
    else:
        print("[warn] RERANK_MODEL is empty: GraphRAG keeps the fusion order")
    try:
        from backend.workflow.db import init_db
        init_db()
        print(f"[ok]   SQLite {settings.sqlite_url}")
    except Exception as e:  # noqa: BLE001
        ok = False
        print(f"[FAIL] SQLite: {e}")
    pacient = settings.sample_data_dir / "Pacient"
    if pacient.is_dir():
        print(f"[ok]   Sample data: {len(list(pacient.glob('[0-9]*.docx')))} documents in {pacient}")
    else:
        print(f"[warn] Sample data folder not found: {pacient}")
    return ok


if __name__ == "__main__":
    if "--check" in sys.argv:
        sys.exit(0 if check() else 1)
    print(settings)
