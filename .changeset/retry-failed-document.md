---
'@liasse/core': minor
'@liasse/server': minor
'@liasse/mcp': minor
'@liasse/sdk': minor
---

A failed document can be processed again without uploading its file: `POST /documents/:id/retry` answers 202 with the document queued from the start, the MCP tool `retry_document` does the same, and the SDK has `retryDocument`. Both refuse a document that did not fail (`document_not_failed`) and an unknown or deleted one (`document_not_found`). A retry gives the watched folder its tries back, as an upload of the same bytes does. The document page of the web UI shows a Retry button on a failed document.
