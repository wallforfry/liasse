---
'@liasse/contract': minor
'@liasse/core': minor
'@liasse/sdk': minor
'@liasse/server': minor
'@liasse/eval': minor
---

The first account is created from the web UI. While no account exists, each start prints a one-time setup token to stderr with the onboarding URL (`PUBLIC_URL/ui/`). `GET /api/setup` says whether setup is needed, `POST /api/setup/check` tries settings with the token, and `POST /api/setup` creates the account and saves the settings together, applied at once (`getSetupStatus`, `checkSetup` and `completeSetup` of the SDK). Attempts are limited to 5 a minute per client address, as for sign-in.

Breaking: `AUTH_BOOTSTRAP_EMAIL` and `AUTH_BOOTSTRAP_PASSWORD` are no longer read: the server refuses to start while one is set, and names it. Remove them from `.env` (and from a Coolify application); an existing account is kept, and a new database is set up with the printed token.
