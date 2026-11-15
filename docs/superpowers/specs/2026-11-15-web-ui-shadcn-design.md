# Web UI on shadcn - design

Date: 2026-11-15. Status: approved approach (A), autonomous delivery.

## Intent

Replace the server-rendered `/ui` (Hono `hono/html`, no script) with a modern single-page
application built from shadcn components (Radix, Tailwind), with their interactivity: data
tables, dialogs, dropdowns, toasts, a command palette. The owner wants modern shadcn
components; the UI stays a convenience over the same use cases MCP and REST use.

## Goals

- Every screen of the current UI, rebuilt with shadcn: login, document list (status, type and
  privacy filters, pagination), `needs_review` queue, document page (details, core values,
  fields, text, original file, manual correction, deletion), search, upload, pending
  consolidation changes (rationale, payload, apply or reject with a note).
- One data path: the SPA calls the REST API `/v1` through `@liasse/sdk`. No UI-specific data
  endpoint, no business logic in the browser.
- The security bar of today kept: untrusted document content never runs, strict CSP, CSRF
  protection, session rules of the spec (HttpOnly, SameSite=Strict, Secure on https, in-memory,
  TTL, login rate limit, argon2id password).

## Non-goals

- Multi-user, roles, a full admin UI.
- Server-side rendering or a first paint without JavaScript.
- New product features beyond what the REST API already exposes (a read-only view of types,
  entities and upcoming dates is allowed if it costs little, but not required).

## Anti-goals

- `'unsafe-inline'` or `'unsafe-eval'` anywhere in the CSP.
- Rendering document content as HTML (`dangerouslySetInnerHTML` is forbidden).
- A second copy of a contract schema in the web app: types come from `@liasse/sdk` /
  `@liasse/core/contract`.
- Keeping the old server-rendered UI alongside (remove, do not layer).

## Approaches considered

- **A. SPA on the REST API (chosen).** `apps/web` built by Vite to static files served under
  `/ui`; data through `@liasse/sdk`; the REST API accepts the UI session cookie besides Bearer,
  with a CSRF header on unsafe methods. One data path for MCP, REST and UI; costs a second
  credential kind on `/v1` and a build step.
- **B. React SSR plus hydration.** Two render environments and UI-specific server logic, for a
  first paint without JS that a single-user app behind a password does not need.
- **C. SPA with a UI-only JSON backend.** Duplicates the REST API. Dropped.

## Design

### `apps/web` (`@liasse/web`, private)

- Vite, React 19, TypeScript strict (repository rules apply: no `as`, readonly, named exports
  except tool configs, functional style), Tailwind CSS v4, shadcn components copied into
  `src/components/ui` (style `new-york`, base color `neutral`, CSS variables, light and dark
  with a theme toggle stored in `localStorage`).
- Routing with React Router, data with TanStack Query over `@liasse/sdk`. Vite `base: '/ui/'`.
- Layout: shadcn `Sidebar` with the navigation (Documents, Review, Search, Upload, Changes),
  a `Command` palette (Cmd/Ctrl+K) for navigation and search, `Sonner` toasts for outcomes,
  `AlertDialog` for deletion and change decisions, `DataTable` (TanStack Table) for lists,
  `Badge` for status and privacy, `Tabs` on the document page, `Skeleton` while loading.
- Document text and every extracted value are rendered as React text nodes only.
- The original file: JPEG and PNG inline as `<img>` from the file route; anything else opens
  through a link, as today.
- Errors of the API (`ApiError` bodies) are shown as their message; a 401 sends to login.

### Server

- The session machinery (`password.ts`, `sessions.ts`, `login-limit.ts`) is kept and moves
  next to the HTTP layer; the page routes, views, `markup.ts`, `style.ts`, `form-fields.ts`,
  `correction.ts` and the page error handler are deleted with their tests.
- JSON session endpoints under `/ui/session` (not part of the agent API, not in OpenAPI):
  `POST` logs in (`{ password }`, same rate limit and hashing bound, 503 with `Retry-After`
  beyond the concurrent hashes), `GET` returns `{ csrfToken }` for a live session or 401,
  `DELETE` logs out (needs the CSRF header).
- Cookie `liasse_session`: HttpOnly, SameSite=Strict, `Path=/` (it must reach `/v1`), lifetime
  `UI_SESSION_TTL`, Secure when `PUBLIC_URL` is https.
- `/v1` authentication: a request with an `Authorization` header is judged on the Bearer token
  only. Without one, a live session cookie authenticates it; for any method other than GET,
  HEAD and OPTIONS it must also carry `X-CSRF-Token` equal to the session's token, compared in
  constant time, else 403. With `UI_PASSWORD` unset, cookies are never accepted.
- `/ui/*` serves the built assets of `@liasse/web` (hashed files with a long immutable cache)
  and falls back to `index.html` for client routes (no-cache). Only mounted when `UI_PASSWORD`
  is set. A missing build with `UI_PASSWORD` set is a `StartupError` with a complete message.
  The assets directory is resolved from the `@liasse/web` package at startup, never a literal
  path.
- CSP for `/ui`: `default-src 'none'; script-src 'self'; style-src 'self' 'nonce-<n>';
img-src 'self' data:; font-src 'self'; connect-src 'self'; form-action 'self';
base-uri 'none'; frame-ancestors 'none'`. `index.html` is served with a per-request nonce
  exposed to the app (meta tag, passed to `get-nonce` / any style-injecting library) so the
  style tags Radix scroll lock or Sonner insert are allowed. Vite's inline module preload
  polyfill is disabled. The file route keeps its `sandbox` policy.
- `pnpm build` builds the web app before the server needs it; lint, typecheck and test cover
  `apps/web`.

### Spec

`docs/spec.md` is updated: the Web UI section (sessions, untrusted content, CSP), the access
section, and the decision table row "UI stack" (now: SPA built with Vite, React and shadcn,
served by the server, calling the REST API with the session cookie; no SSR).

## Verification

- Server tests: login and logout over JSON, rate limit, 503 beyond concurrent hashes, cookie
  attributes, `/v1` accepted with a session cookie on GET, refused without or with a wrong
  `X-CSRF-Token` on POST/PATCH/DELETE, Bearer requests ignore cookies, cookies refused when
  `UI_PASSWORD` is unset, static serving with fallback and the CSP header with a fresh nonce.
- Web tests (Vitest, jsdom, Testing Library): the API client sends the CSRF header on unsafe
  methods and redirects to login on 401; document content containing markup renders as text.
- Manual check in a browser: every screen, both themes, no CSP violation in the console.

## Left to the builder

Exact component composition, file layout inside `apps/web`, the router flavour details, test
helper shape, whether to add read-only views of types, entities and upcoming dates.
