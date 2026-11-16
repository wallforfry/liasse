---
'@liasse/contract': minor
'@liasse/core': minor
'@liasse/server': minor
'@liasse/mcp': minor
'@liasse/sdk': minor
'@liasse/web': minor
---

`GET /documents/:id` and `get_document` answer `analysis_pending`: whether a processing, re-extraction or reclassification of the document is queued or running, while its status stays `indexed` or `needs_review`.

The web UI asks for the type to be analysed again from the review of a `needs_review` document, as a third choice for its type next to Accept and Change, with an optional hint; the model creates a new type when none fits, without a checkbox. The separate section of the edit tab is gone. The document page follows a pending analysis from `analysis_pending`, so a reload or leaving the page no longer loses it, and says when it ends.
