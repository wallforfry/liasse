---
'@liasse/sdk': minor
'@liasse/core': minor
'@liasse/server': patch
---

Add the TypeScript SDK. `createLiasseClient({ baseUrl, token, fetch?, timeoutMs? })` covers every REST route, uploads with the native `FormData` and `Blob`, parses every answer against the schemas of the server and rejects with `LiasseApiError` (status, stable code, request id, details) when the API refuses a request. The schemas and types of requests and answers move from `@liasse/core/api` to the new `@liasse/core/contract`, which loads nothing but Zod when imported. The answers of `/subjects` and `/upcoming` and the references they hold (`untrustedText`, `documentRefSchema`, `subjectRefSchema`) are defined there too, and no longer exported by `@liasse/core/api` and `@liasse/core/knowledge`.
