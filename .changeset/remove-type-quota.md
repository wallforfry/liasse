---
'@liasse/contract': minor
'@liasse/core': minor
'@liasse/sdk': minor
'@liasse/mcp': patch
'@liasse/server': patch
'@liasse/web': patch
---

The pipeline no longer bounds the new document types it creates per day. A first import on an empty registry used to create five types, then leave every other document without a type, in `needs_review`. A new type starts `provisional`, and consolidation promotes or merges it.

Breaking: the setting `pipeline.max_new_types_per_day` is removed, and `PUT /settings` refuses it. Migration `0024` removes it from the saved settings. The registry no longer refuses with `quota_exceeded`, so `POST /types` never answers it. `MAX_NEW_TYPES_PER_DAY` is no longer refused at startup: it has no effect. The refusal `quota_exceeded` stays in `review.type.refusal` and the `type_refusal` of `classification` events for documents classified before, and nothing assigns it any more. `reclassify_document` (`POST /documents/:id/reclassify`) files such a document, one at a time.
