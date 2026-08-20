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

echo "→ Backend  http://127.0.0.1:8001"
docker compose up -d

if [[ ! -d web/node_modules ]]; then
  echo "→ Instalando dependencias del frontend"
  (cd web && npm install)
fi

echo "→ Frontend http://127.0.0.1:4200"
echo "  Ctrl+C detiene la web. El API sigue en Docker (docker compose stop para apagarlo)."
cd web
exec npm start
