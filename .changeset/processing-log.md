---
'@liasse/contract': minor
'@liasse/core': minor
'@liasse/server': minor
'@liasse/mcp': minor
'@liasse/sdk': minor
'@liasse/web': minor
---

Each document keeps a processing log: every stage that succeeded and every attempt of its jobs that failed, with the stage, the status, the attempt, the error code and class, whether it is retried, the model, and counts such as the values the model returned that were rejected. Nothing read from the document is logged. The 100 most recent events are kept per document and removed with it.

`GET /documents/:id/events` answers the log, the SDK reads it with `listDocumentEvents`, the MCP tool `get_status` adds it as `events`, and the document page of the web UI shows it in a Processing tab. A re-extraction or a re-indexing that fails in a way another attempt cannot fix now ends its job at once, as `process_document` did.
