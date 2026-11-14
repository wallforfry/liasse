---
'@liasse/core': minor
---

Add the document pipeline (`@liasse/core/pipeline`): the `process_document` handler takes a document from `received` to `indexed` or `needs_review` (text extracted in a child process under a memory and a CPU limit, classification against the 8 closest types, one extraction call for the fields, the key dates, the facts and the candidate subjects), with quote verification, per-field provenance, sensitive identifier masking and a confidence. Also `reextract_document` and `reindex_document` jobs, `correctDocument` for manual corrections, and `failAbandonedDocuments` for startup. Entity resolution, masking and indexing are injected. Reading a PDF given as a Node `Buffer` no longer fails.
