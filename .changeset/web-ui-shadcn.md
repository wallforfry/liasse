---
'@liasse/web': minor
'@liasse/server': minor
'@liasse/sdk': minor
'@liasse/contract': minor
---

The web UI is a single-page application, `@liasse/web`, made with Vite, React and shadcn components: document list with status, type and privacy filters, the review queue, the document page with its correction and deletion, search, upload and the consolidation changes, in a sidebar layout with a command palette (Cmd or Ctrl+K), toasts and a light or dark theme. It calls the REST API through the SDK with the session cookie and renders document content as text only.

The server serves its build under `/ui` and refuses to start without it; `GET /` redirects there. The policy of `/ui` admits the scripts and stylesheets of the build and a per-request style nonce, never `unsafe-inline` or `unsafe-eval`. `@liasse/contract` exports `CSP_NONCE_META_PROPERTY`, and `createLiasseClient` takes `session: true` for a page served by the server.
