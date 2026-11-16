#!/usr/bin/env bash
# A tour of the REST API with curl: upload a file, follow its processing, then search, query
# and list upcoming dates. Answers are printed as they come, in JSON.
# Usage: LIASSE_API_KEY=<key> examples/rest.sh <file>
# LIASSE_URL defaults to http://localhost:8080.
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "usage: LIASSE_API_KEY=<key> $0 <file>" >&2
  exit 2
fi

file="$1"
url="${LIASSE_URL:-http://localhost:8080}"
auth="Authorization: Bearer ${LIASSE_API_KEY:?set LIASSE_API_KEY to an API key from the web UI}"

# Prints the answer, or the error body of a refusal on stderr before stopping the script.
call() {
  local answer
  if ! answer="$(curl --silent --show-error --fail-with-body --header "$auth" "$@")"; then
    printf '%s\n' "$answer" >&2
    exit 1
  fi
  printf '%s\n' "$answer"
}

echo '# Upload (201 for a new document, 200 for bytes already known)'
uploaded="$(call --form "file=@$file" --form 'hint=example upload' "$url/documents")"
echo "$uploaded"
id="$(sed -E 's/.*"id":"([^"]+)".*/\1/' <<<"$uploaded")"

echo "# Document $id: processing is asynchronous, its status moves on to indexed or failed"
call "$url/documents/$id"

echo '# Processing log'
call "$url/documents/$id/events"

echo '# Hybrid search'
call --header 'Content-Type: application/json' \
  --data '{"query": "electricity bill", "limit": 5}' "$url/search"

echo '# Structured query: documents per type'
call --header 'Content-Type: application/json' \
  --data '{"aggregate": {"count": "*"}, "group_by": ["type"]}' "$url/query"

echo '# Key dates of the next 90 days'
from="$(date +%Y-%m-%d)"
to="$(date -d '+90 days' +%Y-%m-%d 2>/dev/null || date -v+90d +%Y-%m-%d)"
call "$url/upcoming?from=$from&to=$to"
