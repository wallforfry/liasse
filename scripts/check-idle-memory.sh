#!/usr/bin/env bash
# Idle memory check of the Docker image: starts it with Postgres and pgvector, waits for its
# health check, lets it settle, then fails if the container uses more than the target of
# docs/spec.md (under 150 MiB at idle, Postgres excluded).
# Usage: scripts/check-idle-memory.sh <image>
# IDLE_MEMORY_LIMIT_MIB (default 150), IDLE_SETTLE_SECONDS (default 30) and
# IDLE_SAMPLES (default 10, one per second; the largest counts) tune the measure.
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "usage: $0 <image>" >&2
  exit 2
fi

image="$1"
limit_mib="${IDLE_MEMORY_LIMIT_MIB:-150}"
settle_seconds="${IDLE_SETTLE_SECONDS:-30}"
samples="${IDLE_SAMPLES:-10}"
run="liasse-idle-$$"
network="$run"
database="$run-postgres"
server="$run-server"
secret="$(openssl rand -hex 32)"

cleanup() {
  docker rm --force "$server" "$database" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
}
trap cleanup EXIT

wait_healthy() {
  local container="$1" timeout="$2" status
  for _ in $(seq "$timeout"); do
    status="$(docker inspect --format '{{.State.Health.Status}}' "$container")"
    if [ "$status" = healthy ]; then
      return 0
    fi
    sleep 1
  done
  echo "$container is not healthy after ${timeout}s (status: $status)" >&2
  docker logs "$container" >&2 || true
  return 1
}

docker network create "$network" >/dev/null

docker run --detach --name "$database" --network "$network" \
  --env POSTGRES_USER=liasse --env POSTGRES_PASSWORD=liasse --env POSTGRES_DB=liasse \
  --health-cmd 'pg_isready -U liasse -d liasse' --health-interval 1s \
  pgvector/pgvector:pg16 >/dev/null
wait_healthy "$database" 120

# The models are never called at idle: the provider only has to pass the configuration schema.
docker run --detach --name "$server" --network "$network" \
  --env DATABASE_URL="postgres://liasse:liasse@$database:5432/liasse" \
  --env LLM_PROVIDER=ollama --env TEXT_MODEL=idle-check --env VISION_MODEL=idle-check \
  --env AUTH_SECRET="$secret" --env FILE_URL_SECRET="$secret" \
  --health-interval 1s --health-start-period 0s \
  "$image" >/dev/null
wait_healthy "$server" 120

sleep "$settle_seconds"

# The usage of the container's cgroup (v2) less its inactive page cache: what `docker stats`
# shows, read in bytes instead of a rounded, human-readable size.
used_bytes() {
  docker exec "$server" sh -c \
    'echo "$(cat /sys/fs/cgroup/memory.current) $(grep "^inactive_file " /sys/fs/cgroup/memory.stat)"' |
    awk '{ print $1 - $3 }'
}

peak_bytes=0
for _ in $(seq "$samples"); do
  bytes="$(used_bytes)"
  if [ "$bytes" -gt "$peak_bytes" ]; then
    peak_bytes="$bytes"
  fi
  sleep 1
done

peak_mib=$((peak_bytes / 1024 / 1024))
echo "Idle memory of $image: ${peak_mib} MiB (limit ${limit_mib} MiB, largest of $samples samples after ${settle_seconds}s)"
if [ "$peak_mib" -ge "$limit_mib" ]; then
  echo "The idle container uses more than the target of docs/spec.md." >&2
  exit 1
fi
