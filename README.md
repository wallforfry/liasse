# Liasse

**Lightweight, agent-first document management.** Hand Liasse your documents; it reads them, files them into types it evolves on its own, tracks key dates and links between documents, and exposes everything to your agents over MCP.

> **Status:** early development, not usable yet. The foundation is in place (monorepo, configuration, database schema and migrations, model ports, a server that only answers `GET /health`); ingestion, search, MCP and the UI are in progress. See [`docs/spec.md`](docs/spec.md).

## Why

Self-hosted document managers rely on classic OCR, manual tags and a UI built for filing by hand. Liasse starts from the other end:

- **Agent first** — MCP is the primary interface (search, structured queries, upcoming deadlines, timelines, ingestion).
- **Emergent types** — a small fixed core of fields, plus document types and schemas proposed by an LLM and consolidated over time.
- **Knowledge layer** — key dates, links between documents, subjects and sourced facts, so questions like _"which contracts expire this quarter?"_ get a direct answer.
- **Lightweight** — one Node container and one Postgres (with pgvector). No broker, no separate worker.
- **Private by default** — any LLM provider, including fully local; local embeddings by default; no telemetry.

## Planned stack

TypeScript · Node 22 · Hono · Drizzle · Zod · Postgres + pgvector · MCP TypeScript SDK · Vercel AI SDK

## Run with Docker

`docker-compose.yml` runs Liasse and Postgres (with pgvector); the server applies its migrations at startup. Next to it, write a `.env` from [`.env.example`](.env.example) (models, `AUTH_SECRET`, `FILE_URL_SECRET`, and `AUTH_BOOTSTRAP_EMAIL` with `AUTH_BOOTSTRAP_PASSWORD` for the first account) and add the variables of the compose file:

| Variable            | Default                 | Role                                                                             |
| ------------------- | ----------------------- | -------------------------------------------------------------------------------- |
| `POSTGRES_PASSWORD` | required                | Database password, put in a URL: use letters and digits (`openssl rand -hex 24`) |
| `PUBLIC_URL`        | `http://localhost:8080` | Origin clients reach Liasse at                                                   |
| `LIASSE_LISTEN`     | `127.0.0.1:8080`        | Host address and port the container is published on                              |
| `LIASSE_VERSION`    | `latest`                | Tag of `ghcr.io/wallforfry/liasse`                                               |

```bash
docker compose up -d
```

The compose file sets `DATABASE_URL`, `HOST`, `PORT`, `STORAGE_PATH` and `EMBEDDING_CACHE_DIR` itself. Files and the local embedding model live in the `liasse-data` volume, the database in `postgres-data`. Liasse speaks plain HTTP: put a TLS reverse proxy in front of it before publishing it beyond `127.0.0.1`. The image carries the build of the web UI, served at `PUBLIC_URL/ui/` (`/` redirects there). Sign in with the bootstrap account, then create an API key for each agent or program on the API keys screen: the REST API, the SDK and MCP take it as `Authorization: Bearer <key>`. MCP clients that speak OAuth can instead connect to `PUBLIC_URL/mcp` and sign in through the web UI, once `PUBLIC_URL` is https.

Inside the container, `127.0.0.1` is the container itself: an Ollama server on the host is `LLM_BASE_URL=http://host.docker.internal:11434` (on Linux, add `extra_hosts: ['host.docker.internal:host-gateway']` to the `liasse` service), and a `WATCH_DIR` needs a volume that mounts the host folder at that path.

On shutdown the server lets running jobs finish for 30 seconds, so the compose file gives the container 40 seconds before Docker kills it; with `docker run`, pass `--stop-timeout 40`.

The image (`linux/amd64`, `linux/arm64`) is published to GHCR by the `Image` workflow: `edge` and `sha-<commit>` for every push to `main`, `<version>`, `<major>.<minor>` and `latest` for every `v*` tag. While the repository is private, so is the package: `docker login ghcr.io` with a token that can read it first. `latest` exists only once a `v*` tag is published; until then, set `LIASSE_VERSION=edge`, or Compose, finding no image to pull, builds it from the checkout. `docker compose up -d --build` always builds from the checkout.

[`docker-compose.coolify.yml`](docker-compose.coolify.yml) is the same stack for a Coolify Docker Compose application built from this repository: Coolify generates the database password, `AUTH_SECRET`, `FILE_URL_SECRET` and the password of the first account, and routes the domain set on the `liasse` service to port 8080. Create the application from the repository with the Docker Compose build pack and `/docker-compose.coolify.yml` as its Docker Compose location, set `AUTH_BOOTSTRAP_EMAIL`, `LLM_PROVIDER`, `LLM_API_KEY`, `TEXT_MODEL` and `VISION_MODEL` among its environment variables, and read the generated `SERVICE_PASSWORD_64_ADMIN` there to sign in to the web UI, then change it there. The sign-in rate limit (5 attempts per minute) counts each client apart only when `TRUSTED_PROXIES` lists the proxies in front of Liasse: the compose file trusts the private networks Coolify's proxy reaches the container from; when Cloudflare proxies the domain, set `TRUSTED_PROXIES` to `10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,cloudflare` among the environment variables. Never trust a range clients can connect from directly: they could then pick the address they are counted under. Without it, every client counts as the proxy, so anyone who reaches the login page can keep the owner out for as long as they keep trying; API keys keep working meanwhile.

## Contributing

Contributions are welcome once the first milestone lands. Please read [`CONTRIBUTING.md`](CONTRIBUTING.md). Everything in this repository is written in English.

## License

[AGPL-3.0](LICENSE)
