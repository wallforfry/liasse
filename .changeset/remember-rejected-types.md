---
'@liasse/core': minor
'@liasse/mcp': patch
'@liasse/server': patch
---

`reclassify_document` (`POST /documents/:id/reclassify`) remembers every type a person rejected for a document: the type of each request joins those of the earlier ones, and none of them is offered again, so two requests in a row no longer bounce between two wrong types. The list is emptied when a person sets the type by hand (`update_document`, `PATCH /documents/:id` with a type), and a type merge carries a rejected source over to its target. Migration `0021` adds the column `documents.rejected_type_ids`. A reclassification queued before the upgrade and still pending runs with no remembered rejection.
