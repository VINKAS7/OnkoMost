#!/usr/bin/env bash
# One-time setup of the optional mockup1 backend on Linux: Python venv + requirements, backend/.env, pathway viewer.
#   scripts/setup.sh            (from anywhere; VENV=.venv inside mockup1/ by default, VENV= uses the current Python)
# The static prototype itself needs none of this (python3 -m http.server is enough without the document scan).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # mockup1/
cd "$ROOT"
VENV="${VENV-.venv}"

if [ -n "$VENV" ]; then
  [ -d "$VENV" ] || python3 -m venv "$VENV"
  # shellcheck disable=SC1091
  . "$VENV/bin/activate"
fi
python -m pip install -U pip
python -m pip install -r backend/requirements.txt

if [ ! -f backend/.env ]; then
  # Local Docker Neo4j (scripts/services.sh) with a random password, used on the container's first start.
  # If the onkomost-neo4j container already exists, put its password here instead.
  cat > backend/.env <<EOF
NEO4J_URI=neo4j://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=$(python -c 'import secrets; print(secrets.token_urlsafe(16))')
EOF
  echo "Created backend/.env"
fi

[ -f einfracz.key ] || echo "Note: put the e-INFRA CZ API key into mockup1/einfracz.key for the document scan."

if command -v npm >/dev/null; then
  (cd pathway-viewer && npm install && npm run build)
else
  echo "npm not found – skipping pathway-viewer (only needed to edit pathways / regenerate engine.js)"
fi

echo
echo "Next (from mockup1/):"
echo "  scripts/services.sh start                                          # Neo4j in Docker"
echo "  .venv/bin/python -m backend.dx_graph import seed/pathways/diagnostic/*.json"
echo "  .venv/bin/uvicorn backend.app:app --port 8000                      # http://localhost:8000/#/gp"
