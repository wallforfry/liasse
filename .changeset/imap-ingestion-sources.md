---
'@liasse/contract': minor
'@liasse/core': minor
'@liasse/server': minor
---

Ingestion sources: documents read from places configured through the API of the web UI, each with sealed credentials and a cursor, polled by a recurring `source_poll` job. The first kind is IMAP: any mailbox, Gmail included through an app password, read-only (`EXAMINE`, no flag ever set), from a start date, keeping by default only the messages with an attachment, each ingested whole as an `.eml` so that its attachments become documents of their own.

`GET`/`POST /sources`, `GET`/`PATCH`/`DELETE /sources/:id`, `POST /sources/:id/check` and `POST /sources/:id/run` take the session cookie only. A refused password stops the polling of the source until it is saved again. A source never revives a deleted document. Documents read from a source have the source `connector`, and `document_origins` says which source found them and under which name.
