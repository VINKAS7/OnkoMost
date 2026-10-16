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
    neo4j_uri: str = os.getenv("NEO4J_URI", "neo4j://localhost:7687")
    neo4j_user: str = os.getenv("NEO4J_USER", "neo4j")
    neo4j_password: str = os.getenv("NEO4J_PASSWORD", "")
    ollama_url: str = os.getenv("OLLAMA_URL", "http://localhost:11434")
    medgemma_model: str = os.getenv("MEDGEMMA_MODEL", "medgemma:4b")
    sqlite_url: str = _sqlite_url(os.getenv("SQLITE_URL", "sqlite:///backend/data/onkomost.sqlite3"))
    sample_data_dir: Path = Path(os.getenv("SAMPLE_DATA_DIR", str(ROOT / "sample")))
    raw_dir: Path = ROOT / "storage" / "raw"
    llm_cache_dir: Path = ROOT / "storage" / "llm_cache"
    reports_dir: Path = ROOT / "storage" / "reports"


settings = Settings()
for _d in (settings.raw_dir, settings.llm_cache_dir, settings.reports_dir):
    _d.mkdir(parents=True, exist_ok=True)


def check() -> bool:
    ok = True
    try:
        from backend.graph.store import graph
        info = graph.ping()
        print(f"[ok]   Neo4j {settings.neo4j_uri} – {info}")
    except Exception as e:  # noqa: BLE001
        ok = False
        print(f"[FAIL] Neo4j {settings.neo4j_uri}: {e}")
    try:
        import httpx
        tags = httpx.get(f"{settings.ollama_url}/api/tags", timeout=5).json()
        names = [m["name"] for m in tags.get("models", [])]
        if any(n.split(":")[0] == settings.medgemma_model.split(":")[0] for n in names):
            print(f"[ok]   Ollama {settings.ollama_url} has {settings.medgemma_model}")
        else:
            ok = False
            print(f"[FAIL] Ollama is up but {settings.medgemma_model} is not pulled (have: {names})")
    except Exception as e:  # noqa: BLE001
        ok = False
        print(f"[FAIL] Ollama {settings.ollama_url}: {e}")
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
