---
'@liasse/core': minor
'@liasse/server': minor
---

Add the REST API and the server runtime. `@liasse/core/api` holds the use cases REST and MCP share (upload, read, list and delete a document, download its file, search, query, types, entities), with stable error codes and signed file URLs valid for 15 minutes. The server now builds itself from the configuration (migrations, storage check, embedder, workers, watched folder), authenticates every route but `/health` (with the API keys and sessions of the better-auth changeset), serves `/metrics` (Prometheus) and `/openapi.json`, logs on stderr only and drains requests and jobs on SIGTERM. New variable `PUBLIC_URL`: the origin signed file URLs start with. `@liasse/core/formats` is now the one definition of each accepted format for ingestion and text extraction; an email that starts with a byte order mark or blank lines is refused. Routes of features that are not merged yet (`PATCH /documents/:id`, `/subjects`, `/upcoming`, `/changes`) answer 501.
