---
'@liasse/core': minor
'@liasse/server': minor
---

The server processes documents. It binds the pipeline: an uploaded or watched document is read, classified, extracted and indexed by the `process_document` job, `reextract_document`, `reindex_document` and `detect_links` run too. At startup, a document on its way that no queued or running job will take further is failed with the code `stale`. `PATCH /documents/:id`, `GET /subjects` and `GET /upcoming` answer instead of 501; only consolidation (`GET /changes`, `POST /changes/:id`) still answers 501, and the startup notice now says so.

With `HINDSIGHT_URL` set, a `hindsight_sync` job is queued once a document is indexed, and in the transaction of a correction that flips its `private` flag.

The pipeline queues `detect_links` in the transaction that settles a document, and again after each re-extraction, so a superseded or terminated contract drops out of `upcoming` and no longer counts in the state of its subject. The OpenAPI document describes the answers of `GET /subjects` and `GET /upcoming` (`listSubjectsOutputSchema` and `upcomingOutputSchema` are exported by `@liasse/core/api`). `@liasse/core/testing` exports `startStubServer`, `chatCompletion` and `embeddings`, for tests that answer model calls locally.

`listSubjects` (`@liasse/core/knowledge`) lists the subjects a reader may see, oldest first, with their names and number of visible documents, filtered by kind and by a query read as `getSubject` reads it, at most 100 by default with `truncated`. `PipelineDeps` takes `onPrivacyChanged(tx, documentId)`, which `correctDocument` runs in its transaction when the correction changes the flag.
