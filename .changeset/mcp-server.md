---
'@liasse/mcp': minor
'@liasse/core': minor
'@liasse/server': minor
---

Add the MCP server (`@liasse/mcp`): the fourteen tools of the specification and the `doc://{id}` and `types://` resources, over the use cases of `@liasse/core/api` that REST calls. The server mounts it on `/mcp` (Streamable HTTP, stateless, behind the API tokens) and serves it on the standard streams with `--stdio`, exiting when its input ends. Tool descriptions flag document content as untrusted; failures carry the error codes of REST, `not_implemented` standing for its 501. `ingest` takes a base64 file; `url` answers `not_implemented` for now. `@liasse/core/api` gains the `timeline`, `recall` and `getSubject` use cases, which the server binds to the knowledge layer like `upcoming`, `idSchema`, `CORRECTED_PARTS`, `toApiError` and `invalidRequest`; `@liasse/core/db` exports `sqlStateOf`.
