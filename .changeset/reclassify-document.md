---
'@liasse/contract': minor
'@liasse/core': minor
'@liasse/server': minor
'@liasse/mcp': minor
'@liasse/sdk': minor
---

The type of a settled document can be decided again when the one it got is wrong: `POST /documents/:id/reclassify` answers 202 with the document, the MCP tool `reclassify_document` does the same, and the SDK has `reclassifyDocument`. The request may carry a `hint` (cut to the length of an upload hint) and `new_type`, which asks for a new type only. A `reclassify_document` job asks the model again without the rejected type, tells it that a person said that type is wrong and what they added, then changes the type as a manual correction does, with the provenance of the model, and queues the re-extraction that settles the document. A document that is not `indexed` or `needs_review`, or has a processing, re-extraction or reclassification pending, is refused (`document_not_settled`); an unknown or deleted one is not found. The hint waits on the document (`documents.reclassification_hint`, blanked by a deletion), never in the job. `@liasse/contract` now holds the definitions of the core fields (`CORE_FIELDS`, `CORE_FIELD_NAMES`, `KEY_DATES_FIELD` in `/registry`, no longer exported by `@liasse/core/registry`) and `SETTLED_STATUSES` (in `/domain`), and the web UI edits every core field with the editor of its definition, filled or not.
