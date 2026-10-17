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
    ollama_url: str = os.getenv("OLLAMA_URL", "http://localhost:11434")
    # local LLM in Ollama (MEDGEMMA_MODEL is the old name of the setting)
    llm_model: str = os.getenv("LLM_MODEL") or os.getenv("MEDGEMMA_MODEL") or "qwen3.5:4b"
    # Ollama embedding model for the GraphRAG vector leg; empty = keyword search only.
    # EMBED_DIM is the size of the VECTOR column and must match the model's output.
    embed_model: str = os.getenv("EMBED_MODEL", "qwen3-embedding:0.6b")
    embed_dim: int = int(os.getenv("EMBED_DIM", "1024"))
    sqlite_url: str = _sqlite_url(os.getenv("SQLITE_URL", "sqlite:///backend/data/onkomost.sqlite3"))
    sample_data_dir: Path = Path(os.getenv("SAMPLE_DATA_DIR", str(ROOT / "sample")))
    raw_dir: Path = ROOT / "storage" / "raw"
    llm_cache_dir: Path = ROOT / "storage" / "llm_cache"
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
    try:
        import httpx
        tags = httpx.get(f"{settings.ollama_url}/api/tags", timeout=5).json()
        names = [m["name"] for m in tags.get("models", [])]
        if any(n.split(":")[0] == settings.llm_model.split(":")[0] for n in names):
            print(f"[ok]   Ollama {settings.ollama_url} has {settings.llm_model}")
        else:
            ok = False
            print(f"[FAIL] Ollama is up but {settings.llm_model} is not pulled (have: {names})")
    except Exception as e:  # noqa: BLE001
        ok = False
        print(f"[FAIL] Ollama {settings.ollama_url}: {e}")
    if settings.embed_model:
        from backend.rag import index
        if index.embed(["test"], "passage"):
            print(f"[ok]   Embeddings {settings.embed_model} ({settings.embed_dim} dims)")
        else:
            ok = False
            print(f"[FAIL] Embeddings {settings.embed_model}: not pulled, unreachable or not {settings.embed_dim} "
                  f"dims (ollama pull {settings.embed_model}; see EMBED_DIM)")
    else:
        print("[warn] EMBED_MODEL is empty: GraphRAG uses keyword search only")
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
