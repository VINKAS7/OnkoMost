#!/usr/bin/env bash
# Start the mockup1 prototype with its backend (one process serves the pages and the API).
#
#   scripts/start.sh               Neo4j (Docker) + backend → http://localhost:8000/
#   scripts/start.sh --viewer      … plus the pathway viewer (Vite dev server) → http://localhost:5180/
#   scripts/start.sh --no-neo4j    skip Neo4j (document scan still works; /api/dx-pathways answers 503)
#
# Env: PORT (8000), HOST (127.0.0.1; 0.0.0.0 to reach it from other machines), VIEWER_PORT (5180 in vite.config.ts).
# First time: scripts/setup.sh. Pathways missing in Neo4j are imported from seed/pathways/diagnostic/ automatically.
# Ctrl+C stops the backend and the viewer; Neo4j keeps running (scripts/services.sh stop).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # mockup1/
cd "$ROOT"
PORT="${PORT:-8000}"
HOST="${HOST:-127.0.0.1}"
VIEWER=0
NEO4J=1
for a in "$@"; do
  case "$a" in
    --viewer) VIEWER=1 ;;
    --no-neo4j) NEO4J=0 ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "unknown option $a (see --help)" >&2; exit 2 ;;
  esac
done

PY=.venv/bin/python
[ -x "$PY" ] || { echo "No mockup1/.venv – run scripts/setup.sh first." >&2; exit 1; }
[ -f einfracz.key ] || [ -n "${EINFRA_API_KEY:-}" ] || echo "Note: no einfracz.key / EINFRA_API_KEY – the GP document scan will fail."
if ss -ltn 2>/dev/null | grep -q ":$PORT "; then
  echo "Port $PORT is already in use – set PORT=… (e.g. PORT=8010 scripts/start.sh)." >&2; exit 1
fi

if [ "$NEO4J" = 1 ]; then
  scripts/services.sh start
  # import the diagnostic pathways that are not in Neo4j yet (re-import changed files with: python -m backend.dx_graph import …)
  missing=$("$PY" - <<'EOF'
import json, pathlib
from backend.dx_graph import list_dx_pathways
have = {r["code"] for r in list_dx_pathways()}
for f in sorted(pathlib.Path("seed/pathways/diagnostic").glob("*.json")):
    if json.loads(f.read_text(encoding="utf-8"))["code"] not in have:
        print(f)
EOF
)
  if [ -n "$missing" ]; then
    # shellcheck disable=SC2086
    "$PY" -m backend.dx_graph import $missing
  fi
  echo "[ok]   pathways in Neo4j: $("$PY" -m backend.dx_graph list | awk '{print $1}' | paste -sd' ')"
fi

VIEWER_PID=""
cleanup() { [ -n "$VIEWER_PID" ] && kill "$VIEWER_PID" 2>/dev/null || true; }
trap cleanup EXIT INT TERM
if [ "$VIEWER" = 1 ]; then
  [ -d pathway-viewer/node_modules ] || (cd pathway-viewer && npm install)
  (cd pathway-viewer && exec npm run dev -- --port "${VIEWER_PORT:-5180}") > /dev/null 2>&1 &
  VIEWER_PID=$!
fi

URL="http://localhost:$PORT"
echo
echo "Prototype   $URL/            (01 GP: $URL/#/gp · 02 coordinator: $URL/#/koordinator · 04 MDT: $URL/#/mdt)"
echo "Component   $URL/components/onco-dx-pathway/demo.html?src=/api/dx-pathways/pancreas"
echo "API         $URL/api/dx-pathways · $URL/docs"
[ "$NEO4J" = 1 ] && echo "Neo4j       http://localhost:7474   (Browser; user/password in backend/.env)"
[ "$VIEWER" = 1 ] && echo "Viewer      http://localhost:${VIEWER_PORT:-5180}/"
echo
"$PY" -m uvicorn backend.app:app --host "$HOST" --port "$PORT"
