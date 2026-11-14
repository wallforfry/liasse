---
'@liasse/core': minor
---

Add the structured query DSL (`@liasse/core/query`): `runQuery` parses a JSON query, resolves every field path against the type registry and compiles it to one parameterized statement. It supports the operators `=`, `!=`, `<`, `<=`, `>`, `>=`, `in`, `contains` and `exists`, the aggregates `count`, `sum`, `min`, `max` and `avg` with `group_by`, `select`, `order_by`, `limit` and `offset`, and answers an unknown field with the fields that exist. Private documents are left out unless `include_private` is set, and deleted documents are never returned. An aggregate value or a numeric group key is a JSON number when a double holds it exactly and the string of its exact decimal form otherwise. Errors and warnings are capped at 20 each, and a database failure is thrown as a `QueryExecutionError` that carries no statement.

`documents.provenance` is keyed by the bare field name, and the entity a field was resolved to is read from `provenance.<field>.entity_id` (`entityIdProvenancePath` in `@liasse/core/domain`); the provenance of a list field is an array with one entry per item.

`migrate` now refuses a Postgres server older than 16 with a `PostgresVersionError`: structured queries rely on `pg_input_is_valid`.
