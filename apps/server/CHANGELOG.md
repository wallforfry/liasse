# @liasse/server

## 0.1.0

### Minor Changes

- edaa336: Authentication moves to better-auth: accounts with a password, database sessions that survive a restart, API keys, and OAuth 2.1 for MCP clients. The first account is created at startup from `AUTH_BOOTSTRAP_EMAIL` and `AUTH_BOOTSTRAP_PASSWORD` while no account exists; `AUTH_SECRET` (32 characters or more) and `AUTH_SESSION_TTL` (`7d`) configure the sessions.
  
  The REST API takes an API key as `Authorization: Bearer <key>` or the session cookie, and a change made with the cookie needs the `Origin` of `PUBLIC_URL`. `/mcp` takes an API key or an OAuth access token issued for `PUBLIC_URL/mcp` (when `PUBLIC_URL` is https or on the loopback), never the cookie, and answers a refused request with the RFC 9728 challenge. The auth server answers under `/api/auth` and its discovery documents under `/.well-known`; sign-in is limited to 5 attempts a minute per socket address.
  
  The web UI is always mounted under `/ui`. It signs in with an email and a password, changes the password, creates, lists and revokes API keys, and holds the login and consent pages of the OAuth flow.
  
  `@liasse/contract` exports `AUTH_BASE_PATH`, `MIN_PASSWORD_LENGTH` and `MAX_PASSWORD_LENGTH`. `@liasse/core` has a new `auth` subpath and a migration for the tables of better-auth.
- 01cc23c: The server processes documents. It binds the pipeline: an uploaded or watched document is read, classified, extracted and indexed by the `process_document` job, `reextract_document`, `reindex_document` and `detect_links` run too. At startup, a document on its way that no queued or running job will take further is failed with the code `stale`. `PATCH /documents/:id`, `GET /subjects` and `GET /upcoming` answer instead of 501; only consolidation (`GET /changes`, `POST /changes/:id`) still answers 501, and the startup notice now says so.
  
  With `HINDSIGHT_URL` set, a `hindsight_sync` job is queued once a document is indexed, and in the transaction of a correction that flips its `private` flag.
  
  The pipeline queues `detect_links` in the transaction that settles a document, and again after each re-extraction, so a superseded or terminated contract drops out of `upcoming` and no longer counts in the state of its subject. The OpenAPI document describes the answers of `GET /subjects` and `GET /upcoming` (`listSubjectsOutputSchema` and `upcomingOutputSchema` are exported by `@liasse/core/api`). `@liasse/core/testing` exports `startStubServer`, `chatCompletion` and `embeddings`, for tests that answer model calls locally.
  
  `listSubjects` (`@liasse/core/knowledge`) lists the subjects a reader may see, oldest first, with their names and number of visible documents, filtered by kind and by a query read as `getSubject` reads it, at most 100 by default with `truncated`. `PipelineDeps` takes `onPrivacyChanged(tx, documentId)`, which `correctDocument` runs in its transaction when the correction changes the flag.
- d4503fb: Hybrid search ranks its full-text side with BM25 when ParadeDB `pg_search` 0.26 or later is created in the database. At startup, `prepareFullTextRanking` (`@liasse/core/search`) reads the installed version from the catalog, creates the BM25 index `chunks_bm25_idx` when it is missing or stale, and returns `rankByBm25`; without the extension it returns `rankByFullText` (`ts_rank_cd`) and nothing changes, and with an older one a startup notice says why BM25 is not used. BM25 only orders the chunks: which ones match is still decided by the language-aware `tsvector` query. The index reads `liasse_bm25_document(language, text)`, the lexemes of `liasse_tsvector`, added by a migration.
  
  `ApiContext` takes `fullText`, the ranker `searchDocuments` passes to `search`. `rankByFullText` is exported by `@liasse/core/search`. The index carries a signature of the pg_search version, of its definition and of the functions and text search configurations its lexemes come from, and a startup that finds another one builds it again. BM25 queries turn the planner warnings of pg_search off in their own transaction; no connection carries a pg_search setting. `pnpm db:up:paradedb` starts a Postgres with `pg_search` on `127.0.0.1:54331` and `pnpm test:paradedb` runs the BM25 tests against it.
- e2b7064: Consolidation keeps the type registry from drifting. A `consolidate` job runs every night at 03:00 UTC and after every 20 new documents settled: it puts similar types to the text model as merge candidates, promotes keys most documents of a type keep in `extra` to fields, stabilizes provisional types with five documents, proposes the removal of fields few documents of a large stable type fill, and proposes merges of entities and subjects that look like one. `AUTO_APPLY` decides what applies without approval (`none`, `safe` by default, `all`). Applying a change moves the documents and their values in the transaction of the registry write, keeps every manual correction, and queues a re-extraction of each settled document from its stored text. `GET /changes` lists the pending changes and `POST /changes/:id` applies or rejects one, instead of answering 501. `type_changes` gains the kind `remove_field` and the columns `decided_at` and `note` (migration `0011`). The answers of both routes are in `@liasse/core/contract`, and the SDK types `listChanges` and `decideChange` with them.
- 9ba83bc: Liasse ships as a Docker image (`ghcr.io/wallforfry/liasse`, amd64 and arm64) with poppler and the local embedder, and `docker-compose.yml` runs it with Postgres and pgvector.
- d3ba5e5: `ENTITY_ATTACH_SIMILARITY` and `ENTITY_ARBITRATION_SIMILARITY` set the thresholds of entity resolution by similarity (decimals from 0 to 1, arbitration not above attach); subjects use the same ones. The defaults become 1 and 0.80, measured with the default local embedder by `pnpm eval:calibrate`: similarity alone no longer attaches a mention, the text model decides every candidate from 0.80. Another embedder needs its own measure with `pnpm eval:calibrate`.
- 354ebc9: Lay the foundation: validated configuration, the Postgres schema and migrations for the eleven tables, model ports with deterministic fakes, the untrusted-content prompt helper and a server exposing `GET /health`.
- 14d3f24: The web UI lists the MCP clients connected through OAuth (client id, name, redirect URIs, consented scopes, live tokens, dates) and revokes one after a confirmation. A revoked client loses its refresh tokens, consents and authorization codes not yet redeemed, and `/mcp` refuses every access token issued to it before the revocation, even when the client registers again.
  
  The auth server answers `GET /api/auth/mcp-connections/list` and `POST /api/auth/mcp-connections/revoke` for a signed-in person; `@liasse/contract` exports their schemas and paths. `/mcp` now also refuses an access token whose client was removed, disabled or revoked. `@liasse/core` has a migration for the table `oauth_client_revocations`.
- ff7a0b5: Add the MCP server (`@liasse/mcp`): the fourteen tools of the specification and the `doc://{id}` and `types://` resources, over the use cases of `@liasse/core/api` that REST calls. The server mounts it on `/mcp` (Streamable HTTP, stateless, behind the credentials of the API) and serves it on the standard streams with `--stdio`, exiting when its input ends. Tool descriptions flag document content as untrusted; failures carry the error codes of REST, `not_implemented` standing for its 501. `ingest` takes a base64 file; `url` answers `not_implemented` for now. `@liasse/core/api` gains the `timeline`, `recall` and `getSubject` use cases, which the server binds to the knowledge layer like `upcoming`, `idSchema`, `CORRECTED_PARTS`, `toApiError` and `invalidRequest`; `@liasse/core/db` exports `sqlStateOf`.
- 47cc651: Add the model provider adapters: text, vision and embedding models for Anthropic, OpenAI, Mistral, Gemini, Ollama and OpenAI-compatible servers through the Vercel AI SDK, with `LLM_TIMEOUT` and `EMBEDDING_TIMEOUT`. The server prints a warning at startup when document content is sent to a cloud provider.
- 02ab8b1: Each document keeps a processing log: every stage that succeeded and every attempt of its jobs that failed, with the stage, the status, the attempt, the error code and class, whether it is retried, the model, and counts such as the values the model returned that were rejected. Nothing read from the document is logged. The 100 most recent events are kept per document and removed with it.
  
  `GET /documents/:id/events` answers the log, the SDK reads it with `listDocumentEvents`, the MCP tool `get_status` adds it as `events`, and the document page of the web UI shows it in a Processing tab. A re-extraction or a re-indexing that fails in a way another attempt cannot fix now ends its job at once, as `process_document` did.
- 55ec70b: A model provider that refuses a call now says why. An event of the processing log of a document has `http_status` and `provider_code` (the error type and code of the provider, a network code, or `timeout`) and the `model` of a `model_provider_failed` failure, and the Processing tab of the web UI shows them under the error code. The `job_failed` line of the server log names the class of the cause and, for a provider failure, its provider, model, HTTP status and code. A migration adds the two columns to `document_events`.
- bcf30ea: Add the REST API and the server runtime. `@liasse/core/api` holds the use cases REST and MCP share (upload, read, list and delete a document, download its file, search, query, types, entities), with stable error codes and signed file URLs valid for 15 minutes. The server now builds itself from the configuration (migrations, storage check, embedder, workers, watched folder), authenticates every route but `/health` (with the API keys and sessions of the better-auth changeset), serves `/metrics` (Prometheus) and `/openapi.json`, logs on stderr only and drains requests and jobs on SIGTERM. New variable `PUBLIC_URL`: the origin signed file URLs start with. `@liasse/core/formats` is now the one definition of each accepted format for ingestion and text extraction; an email that starts with a byte order mark or blank lines is refused. Routes of features that are not merged yet (`PATCH /documents/:id`, `/subjects`, `/upcoming`, `/changes`) answer 501.
- 47ba878: A failed document can be processed again without uploading its file: `POST /documents/:id/retry` answers 202 with the document queued from the start, the MCP tool `retry_document` does the same, and the SDK has `retryDocument`. Both refuse a document that did not fail (`document_not_failed`) and an unknown or deleted one (`document_not_found`). A retry gives the watched folder its tries back, as an upload of the same bytes does. The document page of the web UI shows a Retry button on a failed document.
- 3b95f94: Every key on the wire is snake_case. The knowledge answers that were camelCase are renamed: `documentCount` is `document_count` in `GET /subjects` and `get_subject`, `nextDates` is `next_dates` in `get_subject`, and the facts of `timeline` and `recall` carry `valid_from`, `valid_to` and `document_id`, plus `entity_ids` and `subject_ids` in `recall`. The SDK types follow, since they are those of `@liasse/core/contract`. A test of the contract fails on any key of a request or an answer that is not snake_case.
- 4b7c202: `TRUSTED_PROXIES` lists the reverse proxies in front of the server (addresses, CIDR ranges and the keyword `cloudflare`). From one of them, the sign-in rate limit counts the client named by the right-most untrusted address of `X-Forwarded-For`, or by `CF-Connecting-IP` when Cloudflare received the request, so one client behind the proxy no longer locks every other one out. Empty by default: the socket address stays the client. The Coolify compose file trusts the private networks of its proxy.
- c0a2f44: `POST /types` creates a type by hand, `provisional` like one the pipeline creates, judged by the naming rules, primitives and two-level hierarchy of the registry under its lock; a refusal answers 400 with the code of the registry. The daily quota of new types does not refuse it. The SDK gains `createType`, and the web UI a Types page that lists the types with their status, fields and document counts, shows each type, and creates one.
- ccd3c27: The web UI is a single-page application, `@liasse/web`, made with Vite, React and shadcn components: document list with status, type and privacy filters, the review queue, the document page with its correction and deletion, search, upload and the consolidation changes, in a sidebar layout with a command palette (Cmd or Ctrl+K), toasts and a light or dark theme. It calls the REST API through the SDK with the session cookie and renders document content as text only.
  
  The server serves its build under `/ui` and refuses to start without it; `GET /` redirects there. The policy of `/ui` admits the scripts and stylesheets of the build and a per-request style nonce, never `unsafe-inline` or `unsafe-eval`. `@liasse/contract` exports `CSP_NONCE_META_PROPERTY`, and `createLiasseClient` takes `session: true` for a page served by the server.
- 9ba86d3: Add the web UI under `/ui`: document list, document page with its text and original file, search, upload, the `needs_review` queue with a correction form, and the approval of consolidation changes. It applies the use cases of `@liasse/core/api` and treats everything read from documents as text. Access goes through the accounts of the auth server (see the better-auth changeset).

### Patch Changes

- 7c4ca7d: Move the contract into its own package, `@liasse/contract`, which depends on `zod` alone. Installing `@liasse/sdk` no longer installs `@liasse/core` and its server dependencies (Postgres, the ONNX runtime, the AI SDK, pdfjs): the SDK depends on `@liasse/contract` and `zod` only. The root entry holds the schemas and types of every request and answer, formerly `@liasse/core/contract`, which is removed. The pure modules they are built from move with them and are no longer exported by `@liasse/core`: enumerations, shared schemas, values, limits, languages and currencies are in `@liasse/contract/domain` (formerly in `@liasse/core/domain`), the query DSL and its errors in `@liasse/contract/query`, field primitives and `Result` in `@liasse/contract/registry`, entity list options in `@liasse/contract/entities` and the search input in `@liasse/contract/search`.
- 324364a: Add the regression harness of the evaluation set: `pnpm eval:run` ingests the corpus into a throwaway instance with the configured models, has an agent answer the 20 questions through the MCP tools, scores both and writes a report; `pnpm eval:compare` puts reports side by side; `pnpm eval:calibrate` measures the entity similarity thresholds with the configured embedder. `@liasse/server` exports `createRuntime` as `@liasse/server/runtime`. Scoring: a negation no longer reaches past the end of a sentence and reaches three words, a failure reason names five unwanted documents at most, and the bank statement may link `pays` to the car-park ticket.
- 42ae909: Follow-ups of the foundation reviews:
  
  - `migrate` refuses a journal that lists the same migration (same content, same date) twice.
  - A model provider that cannot be reached fails with the network code (`ECONNREFUSED`, `ENOTFOUND`) instead of no code, and a provider error reports both its type and its code. `LLM_BASE_URL` and `EMBEDDING_BASE_URL` are refused when they carry a `?` or a `#`. The startup lookup of a self-hosted endpoint gives up after three seconds, and the privacy warning says when the name did not resolve.
  - The currency list gains `XAD` and loses `CNX`. Type slugs may carry the short forms of months again (`data_set`, `seguro_mar`), and are refused the name of an organisation of two letters (`bp_invoice`).
- d0a82db: A forget no longer clears the record that the Hindsight bank may hold facts of a document while a retain of that document may still land. `documents.hindsight_retain_until`, added by migration `0009`, records until when a retain can reach Hindsight (the longest its request can take, retries included, now stated by `HindsightClient.requestWindowMs`); a forget within that bound is sent, keeps the record and throws `HindsightRetainInFlightError`, and the job runs again once the bound has passed. A retain whose sync lost its lock, or whose process died, can no longer leave facts in the bank with nothing to forget them.
  
  A handler can defer its job without spending an attempt by throwing `DeferJobError` (`@liasse/core/jobs`), optionally with a delay; the workers report it through `onJobDeferred` instead of `onJobFailed`. The `hindsight_sync` handler defers a sync that finds another in progress, one that lost its lock and a forget a retain may still overtake. The server logs these as `job_deferred`, and logs the facts the detector kept out of Hindsight as `hindsight_facts_withheld`, with their count and nothing that names the document.
- a7247ec: Releases are cut by Changesets: merging the version pull request tags `v<version>`, publishes a GitHub release with the changelog and the image tags `<version>`, `<major>.<minor>` and `latest`. The README starts in 5 minutes, `docs/deployment.md` covers the rest of a deployment, and `examples/` holds MCP client configurations and REST calls.
- 3c8ac16: On shutdown, a keep-alive connection that was busy when the listener closed no longer goes on serving requests until the grace period cuts it: a request received after the close is answered with `Connection: close`, which ends the connection.
- 76f76b4: Add the TypeScript SDK. `createLiasseClient({ baseUrl, token, fetch?, timeoutMs? })` covers every REST route, uploads with the native `FormData` and `Blob`, parses every answer against the schemas of the server and rejects with `LiasseApiError` (status, stable code, request id, details) when the API refuses a request. The schemas and types of requests and answers move from `@liasse/core/api` to the new `@liasse/core/contract`, which loads nothing but Zod when imported. The answers of `/subjects` and `/upcoming` and the references they hold (`untrustedText`, `documentRefSchema`, `subjectRefSchema`) are defined there too, and no longer exported by `@liasse/core/api` and `@liasse/core/knowledge`.
- Updated dependencies [edaa336]
- Updated dependencies [01cc23c]
- Updated dependencies [d4503fb]
- Updated dependencies [d91c225]
- Updated dependencies [e2b7064]
- Updated dependencies [7c4ca7d]
- Updated dependencies [2e9decd]
- Updated dependencies [018bd6f]
- Updated dependencies [d3ba5e5]
- Updated dependencies [c3665e3]
- Updated dependencies [42ae909]
- Updated dependencies [354ebc9]
- Updated dependencies [d0a82db]
- Updated dependencies [1251350]
- Updated dependencies [03482cf]
- Updated dependencies [28e5c9d]
- Updated dependencies [14d3f24]
- Updated dependencies [ff7a0b5]
- Updated dependencies [faa8bc9]
- Updated dependencies [47cc651]
- Updated dependencies [027f193]
- Updated dependencies [02ab8b1]
- Updated dependencies [55ec70b]
- Updated dependencies [08bbea2]
- Updated dependencies [bcf30ea]
- Updated dependencies [47ba878]
- Updated dependencies [a7ccb4a]
- Updated dependencies [3b95f94]
- Updated dependencies [2eb4f51]
- Updated dependencies [4b7c202]
- Updated dependencies [1e5abde]
- Updated dependencies [c0a2f44]
- Updated dependencies [76f76b4]
- Updated dependencies [f4ff6f1]
- Updated dependencies [ccd3c27]
- Updated dependencies [9ba86d3]
  - @liasse/core@0.1.0
  - @liasse/web@0.1.0
  - @liasse/contract@0.1.0
  - @liasse/mcp@0.1.0
