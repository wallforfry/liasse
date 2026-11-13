# Liasse

**Lightweight, agent-first document management.** Hand Liasse your documents; it reads them, files them into types it evolves on its own, tracks key dates and links between documents, and exposes everything to your agents over MCP.

> **Status:** specification phase — no code yet. See [`docs/spec.md`](docs/spec.md).

## Why

Self-hosted document managers rely on classic OCR, manual tags and a UI built for filing by hand. Liasse starts from the other end:

- **Agent first** — MCP is the primary interface (search, structured queries, upcoming deadlines, timelines, ingestion).
- **Emergent types** — a small fixed core of fields, plus document types and schemas proposed by an LLM and consolidated over time.
- **Knowledge layer** — key dates, links between documents, subjects and sourced facts, so questions like *"which contracts expire this quarter?"* get a direct answer.
- **Lightweight** — one Node container and one Postgres (with pgvector). No broker, no separate worker.
- **Private by default** — any LLM provider, including fully local; local embeddings by default; no telemetry.

## Planned stack

TypeScript · Node 22 · Hono · Drizzle · Zod · Postgres + pgvector · MCP TypeScript SDK · Vercel AI SDK

## Contributing

Contributions are welcome once the first milestone lands. Please read [`CONTRIBUTING.md`](CONTRIBUTING.md). Everything in this repository is written in English.

## License

[AGPL-3.0](LICENSE)
