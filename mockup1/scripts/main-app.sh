#!/usr/bin/env bash
# Set up and start the main Onkomost app (repo root: backend/ + frontend/) on Linux – the README's Windows/WSL +
# conda steps, done natively. Safe to re-run: every step is skipped when it is already done.
#
#   mockup1/scripts/main-app.sh              setup (if needed) + start the backend → http://localhost:8001
#   mockup1/scripts/main-app.sh --seed       … and (re)load the sample case first (wipes Onkomost data)
#   mockup1/scripts/main-app.sh --setup-only setup, check, no server
#   mockup1/scripts/main-app.sh --no-build   skip the frontend build
#   mockup1/scripts/main-app.sh --einfra[=MODEL]
#                                            use e-INFRA CZ instead of local Ollama: chat MODEL glm-5.3-flash (default)
#                                            or qwen3.8-27b, embeddings qwen3-embedding-4b (2560 dims), through the
#                                            Ollama-compatible bridge backend/einfra_bridge.py (key: mockup1/einfracz.key
#                                            or EINFRA_API_KEY); backend/.env stays as it is, the settings are passed as env
#
# Env: PORT (8001), HOST (127.0.0.1), SEED_UNTIL (histology; one of referral … closed, see scripts/seed_demo.py),
#      VENV (mockup1/.venv-main), BRIDGE_PORT (11435).
# What it does:
#   1. backend/.env from backend/.env.example (old Neo4j-era .env is backed up), IRIS on localhost, random IRIS password,
#      SAMPLE_DATA_DIR = mockup1/data/rakathon_final_all
#   2. Python venv + packages (the repo has no requirements file; list taken from the backend's imports)
#   3. InterSystems IRIS for Health in Docker (infra/iris/start.sh: namespace + FHIR R4 endpoint)
#   4. Ollama models (LLM_MODEL, EMBED_MODEL from backend/.env)
#   5. frontend build (served by the backend)
#   6. python -m backend.config --check, optional seed, uvicorn backend.api:app
set -euo pipefail

MOCKUP="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$MOCKUP/.." && pwd)"
cd "$ROOT"
PORT="${PORT:-8001}"
HOST="${HOST:-127.0.0.1}"
VENV="${VENV:-$MOCKUP/.venv-main}"
SEED_UNTIL="${SEED_UNTIL:-histology}"
SEED=0; SERVE=1; BUILD=1; EINFRA=""
BRIDGE_PORT="${BRIDGE_PORT:-11435}"
for a in "$@"; do
  case "$a" in
    --einfra) EINFRA=glm-5.3-flash ;;
    --einfra=*) EINFRA="${a#--einfra=}" ;;
    --seed) SEED=1 ;;
    --setup-only) SERVE=0 ;;
    --no-build) BUILD=0 ;;
    -h|--help) sed -n '2,25p' "$0"; exit 0 ;;
    *) echo "unknown option $a (see --help)" >&2; exit 2 ;;
  esac
done
say() { printf '\n== %s\n' "$*"; }

# --- 1. backend/.env ------------------------------------------------------------------------------------------
ENV=backend/.env
envget() { [ -f "$ENV" ] && grep -E "^$1=" "$ENV" | tail -1 | cut -d= -f2- | tr -d '\r' || true; }
if [ ! -f "$ENV" ] || ! grep -q '^IRIS_HOST=' "$ENV"; then
  say "backend/.env (IRIS configuration)"
  if [ -f "$ENV" ]; then
    mkdir -p backend/data   # gitignored
    cp "$ENV" "backend/data/.env.neo4j-$(date +%Y%m%d-%H%M%S).bak"
    echo "old $ENV backed up to backend/data/"
  fi
  OLLAMA="$(envget OLLAMA_URL)"
  PW="$(python3 -c 'import secrets; print(secrets.token_urlsafe(12).replace("-", "x").replace("_", "y"))')"
  sed -e "s|^IRIS_HOST=.*|IRIS_HOST=127.0.0.1|" \
      -e "s|^IRIS_PASSWORD=.*|IRIS_PASSWORD=$PW|" \
      -e "s|^SAMPLE_DATA_DIR=.*|SAMPLE_DATA_DIR=$MOCKUP/data/rakathon_final_all|" \
      -e "s|^OLLAMA_URL=.*|OLLAMA_URL=${OLLAMA:-http://localhost:11434}|" \
      backend/.env.example > "$ENV"
  chmod 600 "$ENV"
  echo "wrote $ENV (IRIS on 127.0.0.1, generated IRIS password)"
fi
[ -d "$(envget SAMPLE_DATA_DIR)/Pacient" ] || echo "WARNING: SAMPLE_DATA_DIR=$(envget SAMPLE_DATA_DIR) has no Pacient/ folder – seeding will fail"

# --- 2. Python ------------------------------------------------------------------------------------------------
say "Python venv $VENV"
[ -x "$VENV/bin/python" ] || python3 -m venv "$VENV"
PY="$VENV/bin/python"
if ! "$PY" -c 'import fastapi, uvicorn, sqlalchemy, pydantic, httpx, dotenv, docx, PIL, pytesseract, multipart, iris' 2>/dev/null; then
  "$PY" -m pip install -q -U pip
  "$PY" -m pip install -q fastapi 'uvicorn[standard]' sqlalchemy pydantic httpx python-dotenv python-docx pillow pytesseract \
    python-multipart intersystems-irispython pytest
fi
echo "packages ok"

# --- 3. IRIS --------------------------------------------------------------------------------------------------
say "InterSystems IRIS for Health (Docker)"
if docker compose version >/dev/null 2>&1; then
  bash infra/iris/start.sh
else
  # Ubuntu's docker.io has no compose plugin: do what infra/iris/docker-compose.yml does with plain docker, then run
  # the rest of infra/iris/start.sh (namespace, user, FHIR endpoint) without its `docker compose up` line.
  if ! docker image inspect onkomost-iris:2026.1 >/dev/null 2>&1; then
    echo "building onkomost-iris:2026.1 (pulls intersystems/irishealth-community, several GB)…"
    DOCKER_BUILDKIT=0 docker build -t onkomost-iris:2026.1 infra/iris
  fi
  if docker ps -a --format '{{.Names}}' | grep -qx onkomost-iris; then
    docker start onkomost-iris >/dev/null
  else
    # a new named volume is root-owned; IRIS runs as irisowner and must create /durable/iris itself
    docker volume create onk-iris-data >/dev/null
    docker run --rm --user root --entrypoint sh -v onk-iris-data:/durable onkomost-iris:2026.1 \
      -c 'chown "$(id -u irisowner):$(id -g irisowner)" /durable'
    docker run -d --name onkomost-iris --restart unless-stopped -p 1972:1972 -p 52773:52773 \
      -e ISC_DATA_DIRECTORY=/durable/iris -v onk-iris-data:/durable onkomost-iris:2026.1 >/dev/null
  fi
  tmp="$(mktemp)"
  sed '/docker compose -f/d' infra/iris/start.sh > "$tmp"
  IRIS_NAMESPACE="$(envget IRIS_NAMESPACE)" IRIS_USER="$(envget IRIS_USER)" IRIS_PASSWORD="$(envget IRIS_PASSWORD)" \
    FHIR_PATH="$(envget FHIR_PATH)" bash "$tmp"
  rm -f "$tmp"
fi

# --- 4. models: local Ollama, or e-INFRA CZ through the bridge --------------------------------------------------
BRIDGE_PID=""
cleanup() { [ -n "$BRIDGE_PID" ] && kill "$BRIDGE_PID" 2>/dev/null || true; }
trap cleanup EXIT INT TERM
if [ -n "$EINFRA" ]; then
  say "e-INFRA CZ models via bridge :$BRIDGE_PORT (chat $EINFRA, embeddings qwen3-embedding-4b)"
  [ -f "$MOCKUP/einfracz.key" ] || [ -n "${EINFRA_API_KEY:-}" ] || { echo "no mockup1/einfracz.key or EINFRA_API_KEY" >&2; exit 1; }
  export EINFRA_KEY_FILE="${EINFRA_KEY_FILE:-$MOCKUP/einfracz.key}"
  if ! curl -sf "http://127.0.0.1:$BRIDGE_PORT/api/version" >/dev/null; then
    "$PY" -m uvicorn backend.einfra_bridge:app --host 127.0.0.1 --port "$BRIDGE_PORT" --log-level warning &
    BRIDGE_PID=$!
    for _ in $(seq 1 30); do curl -sf "http://127.0.0.1:$BRIDGE_PORT/api/version" >/dev/null && break; sleep 0.5; done
  fi
  export OLLAMA_URL="http://127.0.0.1:$BRIDGE_PORT" LLM_MODEL="$EINFRA" EMBED_MODEL=qwen3-embedding-4b EMBED_DIM=2560
  curl -sf "$OLLAMA_URL/api/tags" | grep -q "\"$EINFRA\"" || echo "WARNING: $EINFRA is not one of the bridge's models (EINFRA_MODELS)"
else
  say "Ollama models"
  command -v ollama >/dev/null || { echo "ollama not found – install it (https://ollama.com) or use --einfra" >&2; exit 1; }
  for m in "$(envget LLM_MODEL)" "$(envget EMBED_MODEL)"; do
    [ -z "$m" ] && continue
    if ollama list | awk 'NR>1 {print $1}' | grep -qx "$m"; then echo "$m present"; else ollama pull "$m"; fi
  done
fi

# --- 5. frontend ----------------------------------------------------------------------------------------------
if [ "$BUILD" = 1 ]; then
  say "frontend build"
  (cd frontend && { [ -d node_modules ] || npm install; } && npm run build)
fi

# --- 6. check, seed, start --------------------------------------------------------------------------------------
say "configuration check"
"$PY" -m backend.config --check

if [ "$SEED" = 1 ] || [ ! -f backend/data/onkomost.sqlite3 ]; then
  say "seed sample case (until $SEED_UNTIL)"
  "$PY" -m scripts.seed_demo --until "$SEED_UNTIL"
fi

[ "$SERVE" = 1 ] || exit 0
if ss -ltn 2>/dev/null | grep -q ":$PORT "; then
  echo "Port $PORT is already in use – set PORT=…" >&2; exit 1
fi
say "Onkomost → http://localhost:$PORT   (LLM ${LLM_MODEL:-$(envget LLM_MODEL)} via ${OLLAMA_URL:-$(envget OLLAMA_URL)}; IRIS portal http://localhost:52773/csp/sys/UtilHome.csp)"
"$PY" -m uvicorn backend.api:app --host "$HOST" --port "$PORT"
