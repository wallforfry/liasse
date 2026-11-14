---
'@liasse/core': minor
---

Add the evolving type registry (`@liasse/core/registry`): field primitives with their definition, stored JSON Schema and value schemas, enforced naming rules, and transactional operations to create, resolve, list and change types under the daily quota. The document count of a type is now computed from `documents`, and the `doc_types.doc_count` column is dropped.

`SCHEMA_LANGUAGE` now accepts only `en`, `fr`, `de`, `es` or `it`: the registry refuses the month names of that language in type slugs, and any other value fails at startup.
