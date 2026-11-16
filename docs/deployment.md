# Deployment

Liasse is one container and one Postgres with pgvector. [`docker-compose.yml`](../docker-compose.yml) runs both; the [README](../README.md#start-in-5-minutes) walks through a first start. This page covers what comes after.

## Compose variables

The compose file reads `.env` next to it, written from [`.env.example`](../.env.example), and these variables of its own:

| Variable            | Default                 | Role                                                                             |
| ------------------- | ----------------------- | -------------------------------------------------------------------------------- |
| `POSTGRES_PASSWORD` | required                | Database password, put in a URL: use letters and digits (`openssl rand -hex 24`) |
| `PUBLIC_URL`        | `http://localhost:8080` | Origin clients reach Liasse at                                                   |
| `LIASSE_LISTEN`     | `127.0.0.1:8080`        | Host address and port the container is published on                              |
| `LIASSE_VERSION`    | `latest`                | Tag of `ghcr.io/wallforfry/liasse`                                               |

The compose file sets `DATABASE_URL`, `HOST`, `PORT`, `STORAGE_PATH` and `EMBEDDING_CACHE_DIR` itself, over the values of `.env`, which suit a server run from source. Files and the local embedding model live in the `liasse-data` volume, the database in `postgres-data`: back up both.

## Image

The image (`linux/amd64`, `linux/arm64`) carries the server, the build of the web UI, poppler (`pdfinfo` and `pdftoppm`, for scanned PDFs) and the runtime of the local embedder. It runs as the `node` user, keeps its data under `/data` and has a health check on `GET /health`.

The `Image` workflow publishes it to GHCR:

| Tag                                      | Published for                    |
| ---------------------------------------- | -------------------------------- |
| `edge`, `sha-<commit>`                   | every push to `main`             |
| `<version>`, `<major>.<minor>`, `latest` | every release (`v<version>` tag) |

`latest` exists only once a version is released; until then, set `LIASSE_VERSION=edge`, or Compose, finding no image to pull, builds it from the checkout. `docker compose up -d --build` always builds from the checkout. While the repository is private, so is the package: `docker login ghcr.io` with a token that can read it first.

## Upgrades

```bash
docker compose pull
docker compose up -d
```

The server applies pending migrations at startup, in one transaction: a migration that fails leaves the database as it was, and the server refuses to start with the reason in its log (`docker compose logs liasse`). Pin `LIASSE_VERSION` to a version to upgrade only when you choose to, and read the notes of the [releases](https://github.com/wallforfry/liasse/releases) in between first.

On shutdown the server lets running jobs finish for 30 seconds, so the compose file gives the container 40 seconds before Docker kills it; with `docker run`, pass `--stop-timeout 40`.

## Reverse proxy and TLS

Liasse speaks plain HTTP and listens on `127.0.0.1` by default. Put a TLS reverse proxy in front of it before publishing it further, and set `PUBLIC_URL` to the address clients use: signed file URLs start with it, and the web UI's requests that change something must come from that origin. MCP clients that speak OAuth connect to `PUBLIC_URL/mcp` and sign in through the web UI, once `PUBLIC_URL` is https; others pass an API key as `Authorization: Bearer <key>`.

The sign-in rate limit (5 attempts per minute) counts each client apart only when `TRUSTED_PROXIES` lists the proxies in front of Liasse. Without it, every client counts as the proxy, so anyone who reaches the login page can keep the owner out for as long as they keep trying; API keys keep working meanwhile. A trusted range must hold only proxies, and the proxy must rewrite `X-Forwarded-For` from peers it does not trust, or a client could pick the address it is counted under. When Cloudflare proxies the domain, add `cloudflare` to `TRUSTED_PROXIES`.

## Ollama on the host

Inside the container, `127.0.0.1` is the container itself: an Ollama server on the host is `LLM_BASE_URL=http://host.docker.internal:11434`. Docker Desktop resolves that name; on Linux, add `extra_hosts: ['host.docker.internal:host-gateway']` to the `liasse` service, and make Ollama listen on an address the container reaches (`OLLAMA_HOST=0.0.0.0`).

## Watched folder

`WATCH_DIR` needs a volume that mounts the host folder at that path, for instance `/srv/scans:/watch:ro` with `WATCH_DIR=/watch`. Liasse only reads the folder; see [Watched folder](spec.md#api-configuration-and-deployment) in the specification for what it ingests and when.

## Coolify

[`docker-compose.coolify.yml`](../docker-compose.coolify.yml) is the same stack for a Coolify Docker Compose application built from this repository. Coolify generates the database password, `AUTH_SECRET`, `FILE_URL_SECRET` and the password of the first account, and routes the domain set on the `liasse` service to port 8080.

1. Create the application from the repository with the Docker Compose build pack and `/docker-compose.coolify.yml` as its Docker Compose location.
2. Set `AUTH_BOOTSTRAP_EMAIL`, `LLM_PROVIDER`, `LLM_API_KEY`, `TEXT_MODEL` and `VISION_MODEL` among its environment variables.
3. Read the generated `SERVICE_PASSWORD_64_ADMIN` there to sign in to the web UI, then change it there.

The compose file trusts `172.16.0.0/12`, Docker's default range for the network Coolify's proxy reaches the container over; when Cloudflare proxies the domain, set `TRUSTED_PROXIES` to `172.16.0.0/12,cloudflare`. No untrusted container may share a network with `liasse`. Behind a Cloudflare Tunnel, every client counts as the `cloudflared` container unless its address is trusted too.

## Resources

The target is under 150 MiB of RAM for the idle container, Postgres excluded. `scripts/check-idle-memory.sh <image>` starts an image with Postgres, waits for its health check and measures it; CI runs it on every pull request. The local embedding model runs in a child process only while it works, between 0.8 and 1.35 GB at its peak, and ends after 10 minutes without a request.
