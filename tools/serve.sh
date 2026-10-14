#!/usr/bin/env bash
# Serve the web edition of Pixeled for the browser preview.
#
#   ./tools/serve.sh            # binds 0.0.0.0:8000 (the port the preview proxy expects)
#   PORT=9000 ./tools/serve.sh  # any other port
#
# Safe to run twice: if something is already answering on the port it just says so and exits, so it
# can be used as the "make sure the preview is up" step in a script or a support request.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
port="${PORT:-8000}"

cd "$root"

if [ ! -f index.html ] || [ ! -f web/main.js ]; then
  echo "This does not look like the Pixeled repository (no index.html / web/main.js in $root)" >&2
  exit 1
fi

if curl -fsS -o /dev/null --max-time 2 "http://127.0.0.1:${port}/" 2>/dev/null; then
  echo "Pixeled is already served on port ${port}."
  exit 0
fi

echo "Serving ${root} on http://0.0.0.0:${port} (Ctrl+C to stop)"
exec python3 -m http.server "${port}" --bind 0.0.0.0
