---
'@liasse/contract': minor
'@liasse/core': minor
'@liasse/mcp': minor
'@liasse/sdk': minor
'@liasse/server': minor
'@liasse/web': minor
---

A document in `needs_review` says what to review. `GET /documents/:id?include=review` and `get_document` return a `review` part: the current threshold, the reasons the document is flagged (`low_confidence`, `type_pending_extraction`, `type_fallback`, `type_untyped`, `reextraction_failed`, `flagged_at_settlement`, `rejected_values`), and how sure the pipeline is of its type and of each core value and field, with the page and quote it was read from.

A correction (`PATCH /documents/:id`, `update_document`) takes `confirm`, the core values or fields that are right as they are, each with the value it was read with: a confirmation never rewrites the value, makes it manual and clears `needs_review` like a correction. A value that changed since it was read refuses the correction with `value_changed`.

The web UI shows a flagged document with a "To review" card: the reasons in sentences, the type to accept or change, and each doubtful value to accept, reject or edit, sent as one correction; a change of type leaves the fields to the extraction for the new type.
