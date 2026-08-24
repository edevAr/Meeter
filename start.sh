#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if ! command -v docker >/dev/null 2>&1; then
  echo "Necesitas Docker Desktop (o Docker Engine) para el backend."
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker no está en marcha. Abre Docker Desktop y vuelve a intentar."
  exit 1
fi

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Creé .env desde .env.example"
fi

LAN_IP="${MEETER_LAN_IP:-192.168.0.31}"
echo "→ Backend  http://${LAN_IP}:8001"
docker compose up -d

if [[ ! -d web/node_modules ]]; then
  echo "→ Instalando dependencias del frontend"
  (cd web && npm install)
fi

echo "→ Frontend http://${LAN_IP}:4200"
echo "  En el teléfono o tablet usa esa IP, misma Wi‑Fi."
echo "  Ctrl+C detiene la web. El API sigue en Docker (docker compose stop para apagarlo)."
cd web
exec npm start
