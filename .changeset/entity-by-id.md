---
'@liasse/contract': minor
'@liasse/core': minor
'@liasse/sdk': minor
'@liasse/server': minor
'@liasse/web': patch
---

`GET /entities/:id` reads one entity as `GET /entities` lists it, with `include_private` for its document count, and answers `entity_not_found` (404) for an id no entity has, such as the source of a merge. The SDK reads it with `getEntity`. The document list of the web UI uses it: an address whose entity filter names an id no entity has, merged into another or never there, now says so with a button that clears the filter, instead of an empty list under the old name.
