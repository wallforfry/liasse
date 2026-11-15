---
'@liasse/core': patch
---

The classification of a document no longer fails with `model_provider_failed` (HTTP 400, `invalid_request_error:invalid_json_schema` on OpenAI) once a document type exists. Its output schema was a union of the two decisions, sent as a `oneOf` at the root, which OpenAI refuses; it is now one object whose members only one decision uses, read back into the same two decisions.
