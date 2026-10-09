#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

export PATH="/home/rohit/.nvm/versions/node/v22.23.3/bin:$PATH"

PYTHON_BIN="python3"
if [ -f "$ROOT_DIR/server/.venv/bin/python3" ]; then
  PYTHON_BIN="$ROOT_DIR/server/.venv/bin/python3"
fi

echo "Exporting OpenAPI JSON from FastAPI app using $PYTHON_BIN..."
$PYTHON_BIN -c "import json, sys; sys.path.insert(0, '.'); from server.app.main import app; print(json.dumps(app.openapi(), indent=2))" > /tmp/openapi.json

echo "Generating TypeScript types via openapi-typescript..."
pnpm exec openapi-typescript /tmp/openapi.json -o packages/core/src/api-types.ts

echo "API types generated successfully at packages/core/src/api-types.ts"
