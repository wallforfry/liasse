---
'@liasse/mcp': minor
'@liasse/server': minor
---

MCP gains the surface REST had alone. Agents manage types: `create_type` creates a provisional type by hand, `suggest_type` drafts one with the text model, `request_consolidation_run` asks for a consolidation run and `list_consolidation_runs` follows the latest ones. They also list documents (`list_documents`, with the filters of `GET /documents`, the `needs_review` queue included), read the whole processing log of a document (`list_document_events`), delete a document (`delete_document`) and list subjects (`list_subjects`). Each tool calls the use case of its REST route and answers the same thing.
