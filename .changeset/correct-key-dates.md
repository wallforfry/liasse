---
'@liasse/core': minor
'@liasse/mcp': minor
'@liasse/server': minor
---

A correction (`PATCH /documents/:id`, `update_document`) can set or clear `core.key_dates`, where it answered `unsupported_field`. The list given replaces the key dates of the document in its core and in what `upcoming` answers, in one transaction, and a later extraction keeps it. Each date is a `kind`, a `date` and a `label` of at most 200 characters, each kind once per date and at most 50 dates. The notice deadline of a renewal date is still computed from the notice period the document states: a `notice_deadline` given next to a renewal date of such a document is refused (`invalid_value`). `upcoming` no longer flags as `computed` a date a person gave. `key_dates` still cannot be confirmed; the refusal now says to give the dates in `core.key_dates` instead.

The notice period an extraction reads is now stored with the document (migration `0020`): a document extracted before this version gets no notice deadline for the key dates a person gives until it is extracted again.
