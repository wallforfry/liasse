---
'@liasse/core': minor
'@liasse/server': minor
---

Consolidation keeps the type registry from drifting. A `consolidate` job runs every night at 03:00 UTC and after every 20 new documents settled: it puts similar types to the text model as merge candidates, promotes keys most documents of a type keep in `extra` to fields, stabilizes provisional types with five documents, proposes the removal of fields few documents of a large stable type fill, and proposes merges of entities and subjects that look like one. `AUTO_APPLY` decides what applies without approval (`none`, `safe` by default, `all`). Applying a change moves the documents and their values in the transaction of the registry write, keeps every manual correction, and queues a re-extraction of each settled document from its stored text. `GET /changes` lists the pending changes and `POST /changes/:id` applies or rejects one, instead of answering 501. `type_changes` gains the kind `remove_field` and the columns `decided_at` and `note` (migration `0009`).
