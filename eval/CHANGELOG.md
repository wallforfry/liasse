# @liasse/eval

## 0.2.0

### Minor Changes

- c95f7a1: The first account is created from the web UI. While no account exists, each start prints a one-time setup token to stderr with the onboarding URL (`PUBLIC_URL/ui/`). `GET /api/setup` says whether setup is needed, `POST /api/setup/check` tries settings with the token, and `POST /api/setup` creates the account and saves the settings together, applied at once (`getSetupStatus`, `checkSetup` and `completeSetup` of the SDK). Attempts are limited to 5 a minute per client address, as for sign-in.
  
  Breaking: `AUTH_BOOTSTRAP_EMAIL` and `AUTH_BOOTSTRAP_PASSWORD` are no longer read: the server refuses to start while one is set, and names it. Remove them from `.env` (and from a Coolify application); an existing account is kept, and a new database is set up with the printed token.
- 2f21931: The settings live in the database and apply without a restart. The language models and their key, the embedder, the pipeline and Hindsight are one document saved with `PUT /settings`, read with `GET /settings` and tried without saving with `POST /settings/check` (`getSettings`, `saveSettings` and `checkSettings` of the SDK), with the session of the web UI only, never an API key. Keys are encrypted at rest under a key derived from `AUTH_SECRET` and never answered; after a change of `AUTH_SECRET` they are reported `unreadable`, and a save replaces or clears them. Every process on the database, MCP over stdio included, follows a save through `LISTEN`. A save applies at once: jobs in progress finish with the models they started with. The embedder can no longer change once a document exists.
  
  Breaking: `LLM_PROVIDER`, `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_TIMEOUT`, `TEXT_MODEL`, `VISION_MODEL`, `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, `EMBEDDING_API_KEY`, `EMBEDDING_BASE_URL`, `EMBEDDING_TIMEOUT`, `EMBEDDING_MAX_INPUT_TOKENS`, `MAX_FILE_SIZE`, `AUTO_APPLY`, `CONFIDENCE_THRESHOLD`, `MAX_NEW_TYPES_PER_DAY`, `SCHEMA_LANGUAGE`, `MAX_VISION_PAGES`, `ENTITY_ATTACH_SIMILARITY`, `ENTITY_ARBITRATION_SIMILARITY`, `HINDSIGHT_URL`, `HINDSIGHT_BANK` and `HINDSIGHT_API_KEY` are no longer read: the server refuses to start while one is set, and names it. Remove them from `.env` and save their values as settings (`docs/deployment.md`, Upgrading from environment variables). Until they are saved, the server serves the web UI, runs no worker and answers `503 not_configured` on the routes of the API. `pnpm eval:run` and `pnpm eval:calibrate` take their models from a JSON file of settings, `--settings <file>`.

## 0.1.0

### Minor Changes

- 324364a: Add the regression harness of the evaluation set: `pnpm eval:run` ingests the corpus into a throwaway instance with the configured models, has an agent answer the 20 questions through the MCP tools, scores both and writes a report; `pnpm eval:compare` puts reports side by side; `pnpm eval:calibrate` measures the entity similarity thresholds with the configured embedder. `@liasse/server` exports `createRuntime` as `@liasse/server/runtime`. Scoring: a negation no longer reaches past the end of a sentence and reaches three words, a failure reason names five unwanted documents at most, and the bank statement may link `pays` to the car-park ticket.
- c3665e3: Add the public evaluation set (`@liasse/eval`): 50 synthetic documents of one fictitious household with their ground truth, 20 reference questions, a deterministic generator and pure scoring functions. The synthetic builders of `@liasse/core/testing` gain what it needs: `buildSyntheticPdf` writes text in WinAnsiEncoding (the euro sign reads back) and image-only pages from a JPEG, and `buildSyntheticDocx` can store its parts uncompressed.
