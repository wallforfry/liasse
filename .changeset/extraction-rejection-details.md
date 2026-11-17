---
'@liasse/contract': minor
'@liasse/core': minor
'@liasse/mcp': minor
'@liasse/sdk': minor
'@liasse/server': minor
---

The `review` part of a document (`GET /documents/:id?include=review`, `get_document` with `include: ["review"]`) names the values the last extraction dropped: `rejections` lists them by `section` (`core`, `fields`, `extra`, `facts`, `subjects`, `notice_period`), `name`, `reason` (`malformed`, `quote_not_found`, `quote_not_stating_value`, `invalid_value`, `invalid_key`, `duplicate_of_field`, `over_limit`, `unresolved_entity`, `sensitive_identifier`, `identifier_not_in_text`) and `count`, never the value or its quote. A document extracted before this change has only its `rejected_values` count, and an empty `rejections`.

The extraction prompt says what each core field holds: `core.amount` is only an amount due, invoiced or paid, never a share capital, a payroll or a coverage limit, and a field for a place of issuance, a registry or an authority is not filled with the address of a registered office, an establishment or the recipient. A value the model puts in `extra` under the name of an empty field of the type is now read as that field, where it was dropped.
