# Onboarding and settings - design

Date: 2026-11-17. Status: approved decisions, autonomous delivery in three pull requests.

## Intent

Starting Liasse from nothing takes a hand-written `.env` today: provider, two model names, an API
key, two secrets and a bootstrap account, all before the first page loads. The owner wants a
first start that asks for almost nothing, an onboarding screen that creates the first account,
and a settings page where models, keys and pipeline behaviour are chosen and changed.

## Decisions

These were chosen by the owner on 2026-11-17 and replace the matching parts of `docs/spec.md`.

1. **The database holds the application settings; their environment variables are removed.** No
   seeding from env, no env override, no dual path. The environment keeps only what the process
   needs before it can read the database, or to open its listener: see the table below.
2. **The first account is created from the web UI, guarded by a setup token.** While no account
   exists, the server generates a one-time token at startup and prints it to stderr. The
   onboarding screen asks for it. `AUTH_BOOTSTRAP_EMAIL` and `AUTH_BOOTSTRAP_PASSWORD` are
   removed.
3. **Settings apply without a restart.** Saving the settings rebuilds the text model, the vision
   model, the pipeline settings and the Hindsight integration. A job in progress finishes with
   what it started with.
4. **The embedder is chosen at onboarding, then locked.** Its provider and model are part of the
   settings, read-only once a document exists. `EMBEDDING_DIM` stays in the environment, since the
   first migration needs it, and onboarding checks that the chosen model answers vectors of that
   dimension.

## What stays in the environment

| Variable                                        | Why it stays                                                 |
| ----------------------------------------------- | ------------------------------------------------------------ |
| `DATABASE_URL`                                  | Needed to read anything else                                 |
| `HOST`, `PORT`, `PUBLIC_URL`, `TRUSTED_PROXIES` | The listener and the OAuth issuer, built before the database |
| `STORAGE_*`, `S3_*`                             | The file storage is checked at startup                       |
| `AUTH_SECRET`, `FILE_URL_SECRET`                | Secrets that protect what the database holds; see below      |
| `AUTH_SESSION_TTL`                              | better-auth is built once                                    |
| `EMBEDDING_DIM`, `EMBEDDING_CACHE_DIR`          | The vector columns are typed by the first migration          |
| `WATCH_DIR`, `WORKERS`                          | Process resources: a folder watcher and the worker pool      |

Everything else of `packages/core/src/config` moves: `LLM_PROVIDER`, `LLM_API_KEY`,
`LLM_BASE_URL`, `LLM_TIMEOUT`, `TEXT_MODEL`, `VISION_MODEL`, `EMBEDDING_PROVIDER`,
`EMBEDDING_MODEL`, `EMBEDDING_API_KEY`, `EMBEDDING_BASE_URL`, `EMBEDDING_TIMEOUT`,
`EMBEDDING_MAX_INPUT_TOKENS`, `MAX_FILE_SIZE`, `AUTO_APPLY`, `CONFIDENCE_THRESHOLD`,
`MAX_NEW_TYPES_PER_DAY`, `SCHEMA_LANGUAGE`, `MAX_VISION_PAGES`, `ENTITY_ATTACH_SIMILARITY`,
`ENTITY_ARBITRATION_SIMILARITY`, `HINDSIGHT_URL`, `HINDSIGHT_BANK`, `HINDSIGHT_API_KEY`. A server
started with one of them set refuses to start and names it, so an old `.env` is never silently
ignored.

## Settings

- **One source of truth.** The Zod schema of the settings, with the cross-field rules of today
  (API key required by provider, base URL for `openai-compatible`, arbitration threshold not above
  attach, max input tokens refused for the local embedder), lives in `@liasse/contract`. The
  server parses what it reads from the database with it; the web UI builds its form from the same
  types. The defaults of today are the defaults of the schema.
- **Storage.** A `settings` table holding one versioned JSON document (a single row), with
  `updated_at`. A save is a whole document, checked against the schema, written under a version
  check so two concurrent saves cannot lose one another (409 on a stale version).
- **Secrets.** API keys (LLM, embedding, Hindsight) are encrypted at rest with AES-256-GCM under a
  key derived from `AUTH_SECRET` (HKDF, its own `info` label). They are never returned: a read
  answers whether each one is set, and a save either keeps, replaces or clears it.
- **Unconfigured state.** A fresh database has no settings. The server starts anyway, serves the
  onboarding, and starts no worker and no folder watcher until the settings are complete.
- **Hot apply.** The runtime keeps its current parts (models, embedder, bindings, API context)
  behind one holder. A save rebuilds the parts from the new settings and calls `bind` again; the
  queue picks the handler of the current bindings when it claims a job, and the routes read the
  current API context per request. Feature code keeps taking plain values.
- **Check before save.** An endpoint tries a configuration without saving it: one short call to
  the text model, one to the vision model, one embedding whose length is compared with
  `EMBEDDING_DIM`, and a Hindsight ping when a URL is set. Errors are reported per part, without
  the provider's message when it could quote a key.
- **Embedder lock.** A save that changes the embedding provider or model is refused (409) once a
  live document exists.
- **Who may change them.** There are no roles: any signed-in account may. The settings routes
  accept the session cookie only, never an API key or an MCP token, since a leaked key must not be
  able to point the models at another server and read every document sent to them.

## Onboarding

- **Status.** `GET /api/setup` (public) answers `{ "needs_setup": boolean }` and nothing else.
- **Token.** While no account exists, startup generates 32 random bytes, prints them once as a
  notice to stderr with the onboarding URL, and keeps only their hash in memory. A restart prints
  a new one. Attempts are rate limited per client address like sign-in.
- **Check.** `POST /api/setup/check` takes the token and a settings document and runs the check of
  the settings, so onboarding can test models before an account exists.
- **Finish.** `POST /api/setup` takes the token, the account (name, email, password) and the
  settings, and in one transaction under the bootstrap advisory lock creates the account and
  writes the settings, then applies them. It is refused once an account exists. The UI then signs
  in through `/api/auth` as it does today.

## Web UI

- **Onboarding**, shown instead of `/login` while `needs_setup` is true: token, account, language
  models (provider, text and vision models, key or base URL, with a check), embedder (local by
  default, with a check of the dimension), a summary, finish and sign in.
- **Settings**, one page in the account area with sections for language models, embedder
  (read-only once locked, with the reason), pipeline (auto-apply, thresholds, limits, schema
  language) and Hindsight. Keys show as set or not set, with replace and clear. A check button per
  section, a save for the whole document, conflict and validation errors shown in place.

## Delivery

1. **Settings store and hot runtime** (`@liasse/contract`, `@liasse/core`, `apps/server`, `eval`):
   schema, table and migration, encryption, holder and rebind, `GET`/`PUT /v1/settings` and
   `POST /v1/settings/check`, the refusal of removed variables, `.env.example`, compose files,
   README, `docs/spec.md` and `docs/deployment.md`. Until the second pull request the first
   account still comes from the bootstrap variables. The evaluation harness reads its model
   settings from a JSON file given on its command line, parsed with the same schema.
2. **Onboarding on the server**: token, the three setup endpoints, removal of the bootstrap
   variables.
3. **Web UI**: onboarding screens and the settings page, through `@liasse/sdk`.

## Non-goals

- Roles or several administrators.
- Changing the embedder of a database that holds documents (a reindex is a feature of its own).
- Generating `AUTH_SECRET` and `FILE_URL_SECRET` automatically.
