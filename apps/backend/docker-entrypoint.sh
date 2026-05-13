#!/bin/sh
# Backend container entrypoint.
#
# Responsibilities (in order):
#   1. Apply pending TypeORM migrations against the compiled data-source.
#      We invoke the typeorm CLI directly with the JS data-source so the
#      runtime image does NOT need ts-node.
#   2. Exec the provided command (defaults to `node dist/main.js`).
#
# Migration failures abort the boot — a backend that runs against a stale
# schema is worse than one that refuses to start.

set -eu

echo "[entrypoint] applying database migrations..."
node ./node_modules/typeorm/cli.js migration:run -d dist/data-source.js
echo "[entrypoint] migrations complete; starting backend"

exec "$@"
