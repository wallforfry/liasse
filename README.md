# Liasse

**Lightweight, agent-first document management.** Hand Liasse your documents; it reads them, files them into types it evolves on its own, tracks key dates and links between documents, and exposes everything to your agents over MCP.

> **Status:** early, before 1.0; the first release is [v0.1.0](https://github.com/wallforfry/liasse/releases/tag/v0.1.0). Ingestion, classification and extraction, the evolving type registry, consolidation, the knowledge layer, hybrid search, the REST API, MCP, the TypeScript SDK and the web UI are in place. The design is in [`docs/spec.md`](docs/spec.md).

## Why

Self-hosted document managers rely on classic OCR, manual tags and a UI built for filing by hand. Liasse starts from the other end:

- **Agent first.** MCP is the primary interface: search, structured queries, upcoming deadlines, timelines, ingestion.
- **Emergent types.** A small fixed core of fields, plus document types and schemas proposed by an LLM and consolidated over time.
- **Knowledge layer.** Key dates, links between documents, subjects and sourced facts, so that _"which contracts expire this quarter?"_ gets a direct answer.
- **Lightweight.** One Node container and one Postgres with pgvector, no broker, no separate worker. The container stays under 150 MB of RAM at idle, which CI checks on every pull request.
- **Private by default.** Any LLM provider, including fully local ones (Ollama); local embeddings by default; no telemetry.

## Start in 5 minutes

You need Docker with Compose, and either an API key of a model provider (Anthropic, OpenAI, Mistral, Gemini), an [Ollama](https://ollama.com) server, or any OpenAI-compatible server, with a text model and a vision model.

1. Get the compose file and the configuration template:

   ```bash
   git clone https://github.com/wallforfry/liasse.git
   cd liasse
   cp .env.example .env
   ```

2. Edit `.env`:
   - `AUTH_SECRET` and `FILE_URL_SECRET`: two different values from `openssl rand -hex 32`.
   - Add `POSTGRES_PASSWORD=` with a value from `openssl rand -hex 24` (letters and digits only, since it goes into a URL).

3. Start Liasse and Postgres:

   ```bash
   docker compose up -d
   ```

   The server applies its migrations at startup, and `docker compose ps` shows it healthy within a minute. Compose pulls the `latest` image; set `LIASSE_VERSION` in `.env` to pin a version (see [the image and its tags](docs/deployment.md#image)). While the repository is private, so is the image: run `docker login ghcr.io` with a token that can read it first.

4. Read the setup token the server printed at startup (`docker compose logs liasse`), open <http://localhost:8080> and create the first account with it. A restart prints a new token until an account exists.

   Then choose the models: the provider, the text and vision models and their key are settings stored in the database, not variables of `.env`. Until they are saved the server processes nothing; [Settings](docs/deployment.md#settings) shows how to save them with `PUT /settings`. For Ollama on the same machine, its base URL is `http://host.docker.internal:11434` (inside the container, `127.0.0.1` is the container itself; on Linux, see [Ollama on the host](docs/deployment.md#ollama-on-the-host)).

5. Connect your agent to `http://localhost:8080/mcp`. It signs in over OAuth: the login and consent pages of Liasse open in the browser, with no key to copy. With Claude Code:

   ```bash
   claude mcp add --transport http liasse http://localhost:8080/mcp
   ```

   then run `/mcp` in Claude Code and authenticate `liasse`. OAuth needs `PUBLIC_URL` on https or a loopback address, such as this one; elsewhere, or for a client that does not speak OAuth, create an API key on the API keys screen and pass it as `--header "Authorization: Bearer $LIASSE_API_KEY"`.

   Upload a document from the web UI, or ask the agent to ingest one, then ask it about your documents. The first document takes longer: the local embedding model (about 120 MB) is downloaded on first use.

More ways in: [`examples/`](examples/) has MCP client configurations and REST calls with `curl`, and [`packages/sdk`](packages/sdk/README.md) is the TypeScript client.

## Documentation

- [`docs/deployment.md`](docs/deployment.md): the settings, the image and its tags, reverse proxies and TLS, the watched folder, Coolify, upgrades.
- [`.env.example`](.env.example): every configuration variable, with its default.
- [`docs/spec.md`](docs/spec.md): the design, the REST API, the MCP tools, the security model.
- [`eval/README.md`](eval/README.md): the public evaluation set and how to compare models on it.

## Stack

TypeScript on Node (26 in the image and in development; 22 and 24 supported, see `engines` in [`package.json`](package.json)), Hono, Drizzle, Zod, Postgres with pgvector, the MCP TypeScript SDK, the Vercel AI SDK, React with Vite for the web UI.

## Contributing

Please read [`CONTRIBUTING.md`](CONTRIBUTING.md) and the [code of conduct](CODE_OF_CONDUCT.md). Report vulnerabilities privately, as [`SECURITY.md`](SECURITY.md) describes. Everything in this repository is written in English.

## License

[AGPL-3.0](LICENSE)
