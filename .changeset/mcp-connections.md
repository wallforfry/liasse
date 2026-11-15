---
'@liasse/core': minor
'@liasse/server': minor
'@liasse/web': minor
'@liasse/contract': minor
---

The web UI lists the MCP clients connected through OAuth (client id, name, redirect URIs, consented scopes, live tokens, dates) and revokes one after a confirmation. A revoked client loses its refresh tokens, consents and authorization codes not yet redeemed, and `/mcp` refuses every access token issued to it before the revocation, even when the client registers again.

The auth server answers `GET /api/auth/mcp-connections/list` and `POST /api/auth/mcp-connections/revoke` for a signed-in person; `@liasse/contract` exports their schemas and paths. `/mcp` now also refuses an access token whose client was removed, disabled or revoked. `@liasse/core` has a migration for the table `oauth_client_revocations`.
