#!/usr/bin/env bash
# Neo4j (Docker) for the mockup1 backend (diagnostic pathways, backend/dx_graph.py).
#
#   scripts/services.sh start     start (or create) the Neo4j container and wait for Bolt
#   scripts/services.sh stop      stop it
#   scripts/services.sh status    show whether it runs
#   scripts/services.sh logs      follow the container log
#
# Settings come from mockup1/backend/.env (NEO4J_USER, NEO4J_PASSWORD; created by scripts/setup.sh).
# Overridable by env: NEO4J_IMAGE (default neo4j:2026.04-community), NEO4J_CONTAINER (onkomost-neo4j),
# NEO4J_HEAP (1G), NEO4J_PAGECACHE (512M). The database may be shared: everything Onkomost writes is labelled :Onk.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # mockup1/
ENV_FILE="$ROOT/backend/.env"

envval() { [ -f "$ENV_FILE" ] && grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- || true; }

NEO4J_IMAGE="${NEO4J_IMAGE:-neo4j:2026.04-community}"
NEO4J_CONTAINER="${NEO4J_CONTAINER:-onkomost-neo4j}"
NEO4J_USER="$(envval NEO4J_USER)"; NEO4J_USER="${NEO4J_USER:-neo4j}"
NEO4J_PASSWORD="$(envval NEO4J_PASSWORD)"

start_neo4j() {
  if [ -z "$NEO4J_PASSWORD" ]; then
    echo "NEO4J_PASSWORD is empty in $ENV_FILE (min. 8 characters) – run scripts/setup.sh or set it." >&2; exit 1
  fi
  if docker ps --format '{{.Names}}' | grep -qx "$NEO4J_CONTAINER"; then
    echo "[ok]   Neo4j container $NEO4J_CONTAINER already running"
  elif docker ps -a --format '{{.Names}}' | grep -qx "$NEO4J_CONTAINER"; then
    docker start "$NEO4J_CONTAINER" >/dev/null && echo "[ok]   Neo4j container $NEO4J_CONTAINER started"
  else
    # Data lives in named volumes, so the container can be removed/recreated without losing the graph.
    # NEO4J_AUTH only applies on the first start of an empty volume.
    docker run -d --name "$NEO4J_CONTAINER" --restart unless-stopped \
      -p 7474:7474 -p 7687:7687 \
      -v onkomost-neo4j-data:/data -v onkomost-neo4j-logs:/logs \
      -e NEO4J_AUTH="$NEO4J_USER/$NEO4J_PASSWORD" \
      -e NEO4J_server_memory_heap_initial__size="${NEO4J_HEAP:-1G}" \
      -e NEO4J_server_memory_heap_max__size="${NEO4J_HEAP:-1G}" \
      -e NEO4J_server_memory_pagecache_size="${NEO4J_PAGECACHE:-512M}" \
      "$NEO4J_IMAGE" >/dev/null
    echo "[ok]   Neo4j container $NEO4J_CONTAINER created from $NEO4J_IMAGE"
  fi
  printf "       waiting for Bolt on :7687 "
  for _ in $(seq 1 60); do
    if docker exec "$NEO4J_CONTAINER" cypher-shell -u "$NEO4J_USER" -p "$NEO4J_PASSWORD" "RETURN 1" >/dev/null 2>&1; then
      echo " ready (browser: http://localhost:7474)"; return
    fi
    printf "."; sleep 2
  done
  echo " timed out – wrong password in $ENV_FILE for an existing volume? See: scripts/services.sh logs" >&2; exit 1
}

case "${1:-start}" in
  start)  start_neo4j ;;
  stop)   docker stop "$NEO4J_CONTAINER" >/dev/null 2>&1 && echo "Neo4j stopped" || echo "Neo4j was not running" ;;
  status) docker ps -a --filter "name=^${NEO4J_CONTAINER}$" --format 'Neo4j:  {{.Status}} ({{.Image}})' | grep . || echo "Neo4j:  no container" ;;
  logs)   docker logs -f "$NEO4J_CONTAINER" ;;
  *) echo "usage: $0 {start|stop|status|logs}" >&2; exit 2 ;;
esac
