# Liasse

**Lightweight, agent-first document management.** Hand Liasse your documents; it reads them, files them into types it evolves on its own, tracks key dates and links between documents, and exposes everything to your agents over MCP.

> **Status:** pre-release. Ingestion, classification and extraction, the evolving type registry, consolidation, the knowledge layer, hybrid search, the REST API, MCP, the TypeScript SDK and the web UI are in place; no version is tagged yet. The design is in [`docs/spec.md`](docs/spec.md).

## Why

Self-hosted document managers rely on classic OCR, manual tags and a UI built for filing by hand. Liasse starts from the other end:

- **Agent first.** MCP is the primary interface: search, structured queries, upcoming deadlines, timelines, ingestion.
- **Emergent types.** A small fixed core of fields, plus document types and schemas proposed by an LLM and consolidated over time.
- **Knowledge layer.** Key dates, links between documents, subjects and sourced facts, so that _"which contracts expire this quarter?"_ gets a direct answer.
- **Lightweight.** One Node container and one Postgres with pgvector, no broker, no separate worker. The container stays under 150 MB of RAM at idle, which CI checks on every pull request.
- **Private by default.** Any LLM provider, including fully local ones (Ollama); local embeddings by default; no telemetry.

## Start in 5 minutes

You need Docker with Compose, and either an API key of a model provider (Anthropic, OpenAI, Mistral, Gemini) or an [Ollama](https://ollama.com) server with a text model and a vision model.

1. Get the compose file and the configuration template:

   ```bash
   git clone https://github.com/wallforfry/liasse.git
   cd liasse
   cp .env.example .env
   ```

2. Edit `.env`:
   - `LLM_PROVIDER`, `TEXT_MODEL`, `VISION_MODEL`, and `LLM_API_KEY` for a cloud provider. For Ollama on the same machine, set `LLM_BASE_URL=http://host.docker.internal:11434` (inside the container, `127.0.0.1` is the container itself; on Linux, see [Ollama on the host](docs/deployment.md#ollama-on-the-host)).
   - `AUTH_SECRET` and `FILE_URL_SECRET`: two different values from `openssl rand -hex 32`.
   - `AUTH_BOOTSTRAP_EMAIL` and `AUTH_BOOTSTRAP_PASSWORD` (12 characters or more): the first account.
   - Add `POSTGRES_PASSWORD=` with a value from `openssl rand -hex 24` (letters and digits only, since it goes into a URL).

3. Start Liasse and Postgres:

   ```bash
   docker compose up -d
   ```

   The server applies its migrations at startup, and `docker compose ps` shows it healthy within a minute. Until the first version is tagged, set `LIASSE_VERSION=edge` in `.env`, or let Compose build the image from the checkout.

4. Open <http://localhost:8080>, sign in with the bootstrap account, and create an API key on the API keys screen.

5. Connect your agent to `http://localhost:8080/mcp` with that key. With Claude Code:

   ```bash
   claude mcp add --transport http liasse http://localhost:8080/mcp --header "Authorization: Bearer $LIASSE_API_KEY"
   ```

   Upload a document from the web UI, or ask the agent to ingest one, then ask it about your documents. The first document takes longer: the local embedding model (about 120 MB) is downloaded on first use.

More ways in: [`examples/`](examples/) has MCP client configurations and REST calls with `curl`, and [`packages/sdk`](packages/sdk/README.md) is the TypeScript client.

## Documentation

- [`docs/deployment.md`](docs/deployment.md): the image and its tags, reverse proxies and TLS, the watched folder, Coolify, upgrades.
- [`.env.example`](.env.example): every configuration variable, with its default.
- [`docs/spec.md`](docs/spec.md): the design, the REST API, the MCP tools, the security model.
- [`eval/README.md`](eval/README.md): the public evaluation set and how to compare models on it.

## Stack

TypeScript on Node 22, Hono, Drizzle, Zod, Postgres with pgvector, the MCP TypeScript SDK, the Vercel AI SDK, React with Vite for the web UI.

## Contributing

Please read [`CONTRIBUTING.md`](CONTRIBUTING.md) and the [code of conduct](CODE_OF_CONDUCT.md). Report vulnerabilities privately, as [`SECURITY.md`](SECURITY.md) describes. Everything in this repository is written in English.

## License

[AGPL-3.0](LICENSE)
