---
'@liasse/core': minor
---

Add the structured query DSL (`@liasse/core/query`): `runQuery` parses a JSON query, resolves every field path against the type registry and compiles it to one parameterized statement. It supports the operators `=`, `!=`, `<`, `<=`, `>`, `>=`, `in`, `contains` and `exists`, the aggregates `count`, `sum`, `min`, `max` and `avg` with `group_by`, `select`, `order_by`, `limit` and `offset`, and answers an unknown field with the fields that exist. Private documents are left out unless `include_private` is set, and deleted documents are never returned.

`documents.provenance` is keyed by the bare field name, and the entity a field was resolved to is read from `provenance.<field>.entity_id` (`entityIdProvenancePath` in `@liasse/core/domain`).
