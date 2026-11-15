---
'@liasse/core': minor
'@liasse/server': minor
'@liasse/web': minor
'@liasse/sdk': minor
'@liasse/contract': minor
---

Authentication moves to better-auth: accounts with a password, database sessions that survive a restart, API keys, and OAuth 2.1 for MCP clients. The first account is created at startup from `AUTH_BOOTSTRAP_EMAIL` and `AUTH_BOOTSTRAP_PASSWORD` while no account exists; `AUTH_SECRET` (32 characters or more) and `AUTH_SESSION_TTL` (`7d`) configure the sessions.

The REST API takes an API key as `Authorization: Bearer <key>` or the session cookie, and a change made with the cookie needs the `Origin` of `PUBLIC_URL`. `/mcp` takes an API key or an OAuth access token issued for `PUBLIC_URL/mcp` (when `PUBLIC_URL` is https or on the loopback), never the cookie, and answers a refused request with the RFC 9728 challenge. The auth server answers under `/api/auth` and its discovery documents under `/.well-known`; sign-in is limited to 5 attempts a minute per socket address.

The web UI is always mounted under `/ui`. It signs in with an email and a password, changes the password, creates, lists and revokes API keys, and holds the login and consent pages of the OAuth flow.

`@liasse/contract` exports `AUTH_BASE_PATH`, `MIN_PASSWORD_LENGTH` and `MAX_PASSWORD_LENGTH`. `@liasse/core` has a new `auth` subpath and a migration for the tables of better-auth.
