---
'@liasse/web': minor
'@liasse/server': minor
'@liasse/sdk': minor
'@liasse/core': minor
---

The web UI is rebuilt as a single-page application, `@liasse/web`, made with Vite, React and shadcn components: document list with status, type and privacy filters, the review queue, the document page with its correction and deletion, search, upload and the consolidation changes, in a sidebar layout with a command palette (Cmd or Ctrl+K), toasts and a light or dark theme. It calls the REST API through the SDK and renders document content as text only.

The server serves its build under `/ui` and refuses to start with `UI_PASSWORD` set and no build. The server-rendered pages and form routes of `/ui` are removed. The session is opened by `POST /ui/session` (JSON), read by `GET` and ended by `DELETE`; the cookie `liasse_session` now has `Path=/`. With `UI_PASSWORD` set, the REST API accepts that cookie for a request without an `Authorization` header, with `X-CSRF-Token` required on every method but GET, HEAD and OPTIONS; MCP stays Bearer-only. The policy of `/ui` admits the scripts and stylesheets of the build and a per-request style nonce, never `unsafe-inline` or `unsafe-eval`.

`createLiasseClient` takes `session: { csrfToken }` instead of `token`, for a page served by the server. `@liasse/core/contract` exports `CSRF_HEADER`, `CSP_NONCE_META_PROPERTY` and the schemas of the session endpoints.
