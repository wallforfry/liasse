---
'@liasse/contract': minor
'@liasse/core': minor
'@liasse/server': minor
'@liasse/mcp': minor
'@liasse/sdk': minor
---

The values of a settled document can be extracted again for the type it has, without changing or deciding its type again: `POST /documents/:id/reextract` answers 202 with the document, the MCP tool `reextract_document` answers its id and status, and the SDK has `reextractDocument`. The request queues the `reextract_document` job under the row lock of the document, with the refusals of a reclassification (`document_not_settled` for a document on its way, failed, or with a processing, re-extraction or reclassification pending); values corrected or confirmed by hand are kept. `retry_document` is unchanged and still refuses any document that did not fail.

Where processing stands is visible while a document is still `received` with no event in its log: `get_status` now also answers `analysis_pending`, `updated_at` and `job`, the processing job queued or running for the document (`kind`, `state`, `attempts`, `max_attempts`, `queued_at`, `run_after`, and for a queued one `waiting_for`, `worker` with `jobs_ahead` or `delay`). `GET /documents/:id/status` and the SDK's `getDocumentStatus` answer the same, from the use case `getDocumentStatus` of `@liasse/core/api`; `@liasse/contract` has `documentStatusSchema`, `DOCUMENT_STATUS_EVENTS`, `UNFINISHED_JOB_STATUSES` and `JOB_WAITS`.

The description of the MCP tool `list_documents` says that with `status: needs_review` it is the review queue of documents. The descriptions of `list_pending_changes` and `apply_change` now say they are about the type registry and point to it, those of `retry_document`, `reclassify_document` and `reextract_document` say which one to use when, and that of `ingest` asks for `private: true` on sensitive documents and explains the `received` interval.
