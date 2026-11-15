---
'@liasse/core': minor
'@liasse/server': minor
---

Add the web UI under `/ui`: document list, document page with its text and original file, search, upload, the `needs_review` queue with a correction form, and the approval of consolidation changes. It applies the use cases of `@liasse/core/api` and treats everything read from documents as text. Access goes through the accounts of the auth server (see the better-auth changeset).
