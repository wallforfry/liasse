#!/usr/bin/env bash
# Idle memory check of the Docker image: starts it with Postgres and pgvector, waits for its
# health check, lets it settle, then fails if the container uses more than the target of
# docs/spec.md (under 150 MB at idle, Postgres excluded).
# Usage: scripts/check-idle-memory.sh <image>
# IDLE_MEMORY_LIMIT_MB (default 150, in units of 10^6 bytes), IDLE_SETTLE_SECONDS (default 30) and
# IDLE_SAMPLES (default 10, one per second; the largest counts) tune the measure.
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "usage: $0 <image>" >&2
  exit 2
fi

image="$1"
limit_mb="${IDLE_MEMORY_LIMIT_MB:-150}"
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

# --init: the postmaster must not be PID 1 (see the `postgres` service of docker-compose.yml).
docker run --detach --init --name "$database" --network "$network" \
  --env POSTGRES_USER=liasse --env POSTGRES_PASSWORD=liasse --env POSTGRES_DB=liasse \
  --health-cmd 'pg_isready -U liasse -d liasse' --health-interval 1s \
  pgvector/pgvector:pg16 >/dev/null
wait_healthy "$database" 120

# The health check is a Node process started inside the container's cgroup: run every second, it
# landed in the samples and added 4 to 18 MB to some of them. It runs every second until the
# server is healthy (after the restart below too), then no more during the measure. Needs Docker
# Engine 25 or later for --health-start-interval.
docker run --detach --name "$server" --network "$network" \
  --env DATABASE_URL="postgres://liasse:liasse@$database:5432/liasse" \
  --env AUTH_SECRET="$secret" --env FILE_URL_SECRET="$secret" \
  --health-interval 300s --health-start-period 300s --health-start-interval 1s \
  "$image" >/dev/null
wait_healthy "$server" 120

# Without settings the server starts no worker. The models are never called at idle: settings
# without a key only have to pass their schema, and a restart puts them in force with the
# workers they start.
docker exec "$database" psql -U liasse -d liasse -v ON_ERROR_STOP=1 -q -c \
  "INSERT INTO settings (version, document) VALUES (1, '{\"llm\": {\"provider\": \"ollama\", \"text_model\": \"idle-check\", \"vision_model\": \"idle-check\"}}')"
docker restart "$server" >/dev/null
wait_healthy "$server" 120

sleep "$settle_seconds"

# The usage of the container's cgroup (v2) less its inactive page cache: what `docker stats`
# shows, read in bytes instead of a rounded, human-readable size. A host without cgroup v2 in the
# container (cgroup v1, `--cgroupns=host`) has no such files: that is a failure, never a zero.
used_bytes() {
  local current inactive
  current="$(docker exec "$server" cat /sys/fs/cgroup/memory.current)"
  inactive="$(docker exec "$server" sh -c 'grep "^inactive_file " /sys/fs/cgroup/memory.stat' | cut -d' ' -f2)"
  if ! [[ "$current" =~ ^[0-9]+$ && "$inactive" =~ ^[0-9]+$ ]] || [ "$current" -le "$inactive" ]; then
    echo "Cannot read the cgroup v2 memory of $server (memory.current: '$current')." >&2
    return 1
  fi
  echo $((current - inactive))
}

peak_bytes=0
for _ in $(seq "$samples"); do
  bytes="$(used_bytes)"
  if [ "$bytes" -gt "$peak_bytes" ]; then
    peak_bytes="$bytes"
  fi
  sleep 1
done

peak_mb=$((peak_bytes / 1000000))
echo "Idle memory of $image: ${peak_mb} MB (limit ${limit_mb} MB, largest of $samples samples after ${settle_seconds}s)"
if [ "$peak_bytes" -ge $((limit_mb * 1000000)) ]; then
  echo "The idle container uses more than the target of docs/spec.md." >&2
  exit 1
fi
