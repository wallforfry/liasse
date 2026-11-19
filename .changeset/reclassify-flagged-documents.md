---
'@liasse/contract': minor
'@liasse/core': minor
'@liasse/sdk': minor
'@liasse/mcp': minor
'@liasse/server': minor
'@liasse/web': minor
---

The documents flagged for review because of how their type was decided can have it decided again in one action: `POST /documents/reclassify` with `reason` (`type_untyped` or `type_fallback`, `TYPE_REVIEW_REASONS` of `@liasse/contract/domain`) and an optional `limit` (100 at most, and by default), the MCP tool `reclassify_flagged_documents` and `reclassifyFlaggedDocuments` of the SDK, all over the use case `reclassifyFlaggedDocuments` of `@liasse/core/api`. The oldest `needs_review` documents with that reason, private ones included, are each queued as `reclassify_document` queues one, under the row lock of the document; one with a processing, re-extraction or reclassification pending is skipped, and so is one that no longer has the reason once locked. The answer is 202 with the counts `queued`, `skipped` and `remaining` (left beyond `limit`). The review queue of the web UI has a button, "Analyse untyped documents again", that asks for it after a confirmation: it is the way to file the documents a daily quota of new types, since removed, left untyped (`quota_exceeded`). `requestReclassification` of `@liasse/core/pipeline` takes `onlyIf`, what the document must still be under its row lock.
