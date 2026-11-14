---
'@liasse/core': minor
---

Add ingestion: file storage on disk or on any S3-compatible server, `ingestFile` with format detection from the content and deduplication by SHA-256, a job queue on Postgres, and a watched folder. Deleting a document leaves a tombstone (status `deleted`) and removes the stored file through a retried job, queued again at startup if it gave up. Two migrations add that status and the columns `hint`, `watch_requeues` and `file_deleted_at` to `documents`. `MAX_FILE_SIZE` caps an ingested file (50 MB by default). The `s3` driver now requires `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`, and reads `S3_REQUEST_TIMEOUT` and `S3_MIN_UPLOAD_RATE`.
