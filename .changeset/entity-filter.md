---
'@liasse/contract': minor
'@liasse/core': minor
'@liasse/sdk': minor
'@liasse/server': minor
'@liasse/web': minor
---

The `entity` filter of search keeps the documents that name the entity in any entity field, in `core` or in the fields of their type, each item of a list field included, where it read `issuer` and `recipient` only. `GET /documents` (`listDocuments` of the SDK) takes the same `entity` filter, by the id of the entity. The document list of the web UI has an entity filter, picked by a name or an alias, which applies to the list and to its search.
