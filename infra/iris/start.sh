#!/usr/bin/env bash
# Start InterSystems IRIS for Health for Onkomost and make sure the namespace + FHIR R4 endpoint exist.
# Run inside WSL (or any Linux/macOS shell with Docker), from anywhere:
#     bash infra/iris/start.sh
# Settings come from backend/.env: IRIS_NAMESPACE, IRIS_USER, IRIS_PASSWORD, FHIR_PATH.
# Safe to re-run: every step is skipped when it is already done.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$DIR/../../backend/.env"
CONTAINER=onkomost-iris
TIMEOUT_SECONDS=300

env_get() {  # env_get KEY DEFAULT – read KEY from backend/.env (process env wins)
  local v="${!1:-}"
  if [ -z "$v" ] && [ -f "$ENV_FILE" ]; then
    v="$(grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '\r')"
  fi
  echo "${v:-$2}"
}
NAMESPACE="$(env_get IRIS_NAMESPACE ONKOMOST)"
USER_NAME="$(env_get IRIS_USER _SYSTEM)"
PASSWORD="$(env_get IRIS_PASSWORD SYS)"
FHIR_PATH="$(env_get FHIR_PATH /fhir/r4)"

docker compose -f "$DIR/docker-compose.yml" up -d   # builds the image only if it is missing

start=$SECONDS
until docker exec "$CONTAINER" iris session IRIS -U %SYS 'write "ready",!' >/dev/null 2>&1; do
  if [ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null)" != "true" ]; then
    echo "ERROR: container $CONTAINER is not running. Check: docker logs $CONTAINER" >&2
    exit 1
  fi
  if [ $((SECONDS - start)) -ge $TIMEOUT_SECONDS ]; then
    echo "ERROR: IRIS not ready after ${TIMEOUT_SECONDS}s. Check: docker logs $CONTAINER" >&2
    exit 1
  fi
  echo "Waiting for IRIS... ($((SECONDS - start))s)"
  sleep 2
done

q() { printf '%s' "${1//\"/\"\"}"; }  # escape for an ObjectScript string literal

echo "Configuring user $USER_NAME, namespace $NAMESPACE and FHIR endpoint $FHIR_PATH (first run takes a few minutes)..."
docker exec -i "$CONTAINER" iris session IRIS -U %SYS <<EOF
do ##class(Security.Users).UnExpireUserPasswords("*")
kill props  set sc=##class(Security.Users).Get("$(q "$USER_NAME")",.props)  set props("Password")="$(q "$PASSWORD")",props("ChangePassword")=0,props("PasswordNeverExpires")=1  set sc=##class(Security.Users).Modify("$(q "$USER_NAME")",.props)  write "user: ",\$system.Status.GetErrorText(sc),!
zn "HSLIB"
if '##class(%SYS.Namespace).Exists("$NAMESPACE") { do ##class(HS.Util.Installer.Foundation).Install("$NAMESPACE") }
zn "$NAMESPACE"
if '##class(HS.FHIRServer.ServiceInstance).ExistsByUrl("$FHIR_PATH") { do ##class(HS.FHIRServer.Installer).InstallNamespace()  do ##class(HS.FHIRServer.Installer).InstallInstance("$FHIR_PATH","HS.FHIRServer.Storage.JsonAdvSQL.InteractionsStrategy","hl7.fhir.r4.core@4.0.1") }
write "FHIR endpoint $FHIR_PATH: ",##class(HS.FHIRServer.ServiceInstance).ExistsByUrl("$FHIR_PATH"),!
halt
EOF

echo "IRIS is up: superserver :1972, FHIR http://<host>:52773$FHIR_PATH, portal http://<host>:52773/csp/sys/UtilHome.csp"
