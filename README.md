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

`docker-compose.yml` runs Liasse and Postgres (with pgvector); the server applies its migrations at startup. Next to it, write a `.env` from [`.env.example`](.env.example) (models, `API_TOKENS`, `FILE_URL_SECRET`, optionally `UI_PASSWORD`) and add the variables of the compose file:

| Variable            | Default                 | Role                                                                             |
| ------------------- | ----------------------- | -------------------------------------------------------------------------------- |
| `POSTGRES_PASSWORD` | required                | Database password, put in a URL: use letters and digits (`openssl rand -hex 24`) |
| `PUBLIC_URL`        | `http://localhost:8080` | Origin clients reach Liasse at                                                   |
| `LIASSE_LISTEN`     | `127.0.0.1:8080`        | Host address and port the container is published on                              |
| `LIASSE_VERSION`    | `latest`                | Tag of `ghcr.io/wallforfry/liasse`                                               |

```bash
docker compose up -d
```

The compose file sets `DATABASE_URL`, `HOST`, `PORT`, `STORAGE_PATH` and `EMBEDDING_CACHE_DIR` itself. Files and the local embedding model live in the `liasse-data` volume, the database in `postgres-data`. Liasse speaks plain HTTP: put a TLS reverse proxy in front of it before publishing it beyond `127.0.0.1`. `docker compose up -d --build` builds the image from the checkout instead of pulling it.

The image (`linux/amd64`, `linux/arm64`) is published to GHCR by the `Image` workflow: `edge` and `sha-<commit>` for every push to `main`, `<version>`, `<major>.<minor>` and `latest` for every `v*` tag.

## Contributing

Contributions are welcome once the first milestone lands. Please read [`CONTRIBUTING.md`](CONTRIBUTING.md). Everything in this repository is written in English.

## License

[AGPL-3.0](LICENSE)
