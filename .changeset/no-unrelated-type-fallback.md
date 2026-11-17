---
'@liasse/contract': minor
'@liasse/core': minor
'@liasse/mcp': minor
'@liasse/sdk': minor
'@liasse/server': minor
'@liasse/web': minor
---

Classification no longer files a document under an unrelated type. The model reuses a candidate only when it truly describes the document, and proposes a new type otherwise. A new type that cannot be created (daily quota reached, private document with an external embedder, proposal refused twice) leaves the document without a type, in `needs_review`, instead of giving it the closest candidate with a confidence of 0: the type provenance and the `review` part say why in `refusal` (`quota_exceeded`, `private_document`, `invalid_proposal`, `rejected_type`), and the `classification` event in `type_refusal`. The outcome `fallback` is no longer assigned; documents classified before keep it.

`reclassify_document` (`POST /documents/:id/reclassify`) whose new type cannot be created changes nothing: the document keeps its type, values and status, and a failed `classification` event carries the reason as its `error_code`. With `new_type`, a slug that names another existing type is refused instead of taken.

MCP has two new tools, `create_type` and `suggest_type`, the use cases of `POST /types` and `POST /types/suggestion`: an agent can create the type a document needs, outside the daily quota of classification, and then set it with `update_document`. The web UI says why a document has no type.
