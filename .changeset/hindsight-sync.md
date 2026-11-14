---
'@liasse/core': minor
---

Add the optional Hindsight sync (`@liasse/core/hindsight`). With `HINDSIGHT_URL` set, a `hindsight_sync` job retains the facts of a document in the bank `HINDSIGHT_BANK` under the document id, one line per fact (`[doc:<id>] <fact> (valid_from ...)`), and never its text, title, summary or fields. A retain after a re-extraction replaces the previous one; a document that is deleted, flagged private or left without facts is deleted from Hindsight. Without `HINDSIGHT_URL` nothing is queued and no request can be made.

`createHindsightIntegration` gives the server the hook to call, the handler to register, the per-kind concurrency to apply and `requeueForgets`, to call at startup for the forgets that are still owed; `describeHindsight` gives the line of the startup privacy summary. The integration requires a detector of sensitive identifiers (`isSensitive`): a fact it flags is left out, and the count is reported through `onFactsWithheld`.

`documents.hindsight_held_since` records, before any request, that a bank may hold facts of a document, and survives deletion; `documents.hindsight_sent_hash` records the facts Hindsight confirmed. Migration `0007` adds both.

Base URLs (`LLM_BASE_URL`, `EMBEDDING_BASE_URL`, `HINDSIGHT_URL`) share one rule: http or https, without credentials, query string or fragment; a fragment and a trailing `?` or `#` are now refused. `deleteDocument` takes an optional `onDeleted(tx, document)` that runs in the transaction of the deletion.
