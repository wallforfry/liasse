---
'@liasse/core': minor
'@liasse/server': minor
'@liasse/web': minor
'@liasse/sdk': minor
'@liasse/contract': minor
---

A model provider that refuses a call now says why. An event of the processing log of a document has `http_status` and `provider_code` (the error type and code of the provider, a network code, or `timeout`) and the `model` of a `model_provider_failed` failure, and the Processing tab of the web UI shows them under the error code. The `job_failed` line of the server log names the class of the cause and, for a provider failure, its provider, model, HTTP status and code. A migration adds the two columns to `document_events`.
