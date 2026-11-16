# @liasse/web

## 0.1.0

### Minor Changes

- edaa336: Authentication moves to better-auth: accounts with a password, database sessions that survive a restart, API keys, and OAuth 2.1 for MCP clients. The first account is created at startup from `AUTH_BOOTSTRAP_EMAIL` and `AUTH_BOOTSTRAP_PASSWORD` while no account exists; `AUTH_SECRET` (32 characters or more) and `AUTH_SESSION_TTL` (`7d`) configure the sessions.
  
  The REST API takes an API key as `Authorization: Bearer <key>` or the session cookie, and a change made with the cookie needs the `Origin` of `PUBLIC_URL`. `/mcp` takes an API key or an OAuth access token issued for `PUBLIC_URL/mcp` (when `PUBLIC_URL` is https or on the loopback), never the cookie, and answers a refused request with the RFC 9728 challenge. The auth server answers under `/api/auth` and its discovery documents under `/.well-known`; sign-in is limited to 5 attempts a minute per socket address.
  
  The web UI is always mounted under `/ui`. It signs in with an email and a password, changes the password, creates, lists and revokes API keys, and holds the login and consent pages of the OAuth flow.
  
  `@liasse/contract` exports `AUTH_BASE_PATH`, `MIN_PASSWORD_LENGTH` and `MAX_PASSWORD_LENGTH`. `@liasse/core` has a new `auth` subpath and a migration for the tables of better-auth.
- 14d3f24: The web UI lists the MCP clients connected through OAuth (client id, name, redirect URIs, consented scopes, live tokens, dates) and revokes one after a confirmation. A revoked client loses its refresh tokens, consents and authorization codes not yet redeemed, and `/mcp` refuses every access token issued to it before the revocation, even when the client registers again.
  
  The auth server answers `GET /api/auth/mcp-connections/list` and `POST /api/auth/mcp-connections/revoke` for a signed-in person; `@liasse/contract` exports their schemas and paths. `/mcp` now also refuses an access token whose client was removed, disabled or revoked. `@liasse/core` has a migration for the table `oauth_client_revocations`.
- 02ab8b1: Each document keeps a processing log: every stage that succeeded and every attempt of its jobs that failed, with the stage, the status, the attempt, the error code and class, whether it is retried, the model, and counts such as the values the model returned that were rejected. Nothing read from the document is logged. The 100 most recent events are kept per document and removed with it.
  
  `GET /documents/:id/events` answers the log, the SDK reads it with `listDocumentEvents`, the MCP tool `get_status` adds it as `events`, and the document page of the web UI shows it in a Processing tab. A re-extraction or a re-indexing that fails in a way another attempt cannot fix now ends its job at once, as `process_document` did.
- 55ec70b: A model provider that refuses a call now says why. An event of the processing log of a document has `http_status` and `provider_code` (the error type and code of the provider, a network code, or `timeout`) and the `model` of a `model_provider_failed` failure, and the Processing tab of the web UI shows them under the error code. The `job_failed` line of the server log names the class of the cause and, for a provider failure, its provider, model, HTTP status and code. A migration adds the two columns to `document_events`.
- c0a2f44: `POST /types` creates a type by hand, `provisional` like one the pipeline creates, judged by the naming rules, primitives and two-level hierarchy of the registry under its lock; a refusal answers 400 with the code of the registry. The daily quota of new types does not refuse it. The SDK gains `createType`, and the web UI a Types page that lists the types with their status, fields and document counts, shows each type, and creates one.
- ccd3c27: The web UI is a single-page application, `@liasse/web`, made with Vite, React and shadcn components: document list with status, type and privacy filters, the review queue, the document page with its correction and deletion, search, upload and the consolidation changes, in a sidebar layout with a command palette (Cmd or Ctrl+K), toasts and a light or dark theme. It calls the REST API through the SDK with the session cookie and renders document content as text only.
  
  The server serves its build under `/ui` and refuses to start without it; `GET /` redirects there. The policy of `/ui` admits the scripts and stylesheets of the build and a per-request style nonce, never `unsafe-inline` or `unsafe-eval`. `@liasse/contract` exports `CSP_NONCE_META_PROPERTY`, and `createLiasseClient` takes `session: true` for a page served by the server.

### Patch Changes

- f4ff6f1: The Type field of the document correction form is a searchable list of the registry's types, matched by slug, alias or description, instead of free text that the server refused when no type had that slug.
