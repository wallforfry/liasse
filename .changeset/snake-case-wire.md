---
'@liasse/core': minor
'@liasse/sdk': minor
'@liasse/mcp': minor
'@liasse/server': minor
---

Every key on the wire is snake_case. The knowledge answers that were camelCase are renamed: `documentCount` is `document_count` in `GET /subjects` and `get_subject`, `nextDates` is `next_dates` in `get_subject`, and the facts of `timeline` and `recall` carry `valid_from`, `valid_to` and `document_id`, plus `entity_ids` and `subject_ids` in `recall`. The SDK types follow, since they are those of `@liasse/core/contract`. A test of the contract fails on any key of a request or an answer that is not snake_case.
