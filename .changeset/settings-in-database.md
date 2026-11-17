---
'@liasse/contract': minor
'@liasse/core': minor
'@liasse/sdk': minor
'@liasse/server': minor
'@liasse/eval': minor
---

The settings live in the database and apply without a restart. The language models and their key, the embedder, the pipeline and Hindsight are one document saved with `PUT /settings`, read with `GET /settings` and tried without saving with `POST /settings/check` (`getSettings`, `saveSettings` and `checkSettings` of the SDK), with the session of the web UI only, never an API key. Keys are encrypted at rest under a key derived from `AUTH_SECRET` and never answered; after a change of `AUTH_SECRET` they are reported `unreadable`, and a save replaces or clears them. Every process on the database, MCP over stdio included, follows a save through `LISTEN`. A save applies at once: jobs in progress finish with the models they started with. The embedder can no longer change once a document exists.

Breaking: `LLM_PROVIDER`, `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_TIMEOUT`, `TEXT_MODEL`, `VISION_MODEL`, `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, `EMBEDDING_API_KEY`, `EMBEDDING_BASE_URL`, `EMBEDDING_TIMEOUT`, `EMBEDDING_MAX_INPUT_TOKENS`, `MAX_FILE_SIZE`, `AUTO_APPLY`, `CONFIDENCE_THRESHOLD`, `MAX_NEW_TYPES_PER_DAY`, `SCHEMA_LANGUAGE`, `MAX_VISION_PAGES`, `ENTITY_ATTACH_SIMILARITY`, `ENTITY_ARBITRATION_SIMILARITY`, `HINDSIGHT_URL`, `HINDSIGHT_BANK` and `HINDSIGHT_API_KEY` are no longer read: the server refuses to start while one is set, and names it. Remove them from `.env` and save their values as settings (`docs/deployment.md`, Upgrading from environment variables). Until they are saved, the server serves the web UI, runs no worker and answers `503 not_configured` on the routes of the API. `pnpm eval:run` and `pnpm eval:calibrate` take their models from a JSON file of settings, `--settings <file>`.
