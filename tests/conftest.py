"""Tests use their own SQLite file. IRIS is shared: the tests wipe and rebuild ONLY Onkomost's data (^OnkGraph,
Onk.DocChunk and the FHIR resources tagged `onkomost` – the same sample patient the demo uses), and check that nothing
else on the FHIR server changes."""
import os
import sys
import tempfile
from pathlib import Path

_tmp = Path(tempfile.mkdtemp(prefix="onkomost-test-"))
os.environ["SQLITE_URL"] = f"sqlite:///{(_tmp / 'test.sqlite3').as_posix()}"
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

import pytest  # noqa: E402

from backend.config import settings  # noqa: E402

SAMPLE = settings.sample_data_dir
PACIENT = SAMPLE / "Pacient"


def pytest_collection_modifyitems(config, items):
    if not PACIENT.is_dir():
        skip = pytest.mark.skip(reason=f"sample data not found at {PACIENT}")
        for item in items:
            item.add_marker(skip)


@pytest.fixture(scope="session")
def iris_available():
    from backend.fhir.client import fhir
    from backend.graph.store import graph
    try:
        graph.ping()
        fhir.ping()
    except Exception as e:  # noqa: BLE001
        pytest.skip(f"IRIS / FHIR not reachable: {e}")
    return graph
