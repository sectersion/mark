#!/usr/bin/env bash
set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is not set" >&2
  exit 1
fi

cd "$(dirname "$0")/.."
mkdir -p backups
umask 077

out="backups/mark-$(date +%F).sql.gz"
trap 'rm -f "$out.part"' EXIT
pg_dump "$DATABASE_URL" | gzip > "$out.part"
mv "$out.part" "$out"

# ponytail: keeps 14 files, not 14 days; a skipped day shifts the window
ls -1t backups/mark-*.sql.gz | tail -n +15 | xargs -r rm --
echo "wrote $out"
