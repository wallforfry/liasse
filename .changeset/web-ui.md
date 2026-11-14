---
'@liasse/core': minor
'@liasse/server': minor
---

Add the web UI, mounted under `/ui` when `UI_PASSWORD` is set: document list, document page with its text and original file, search, upload, the `needs_review` queue with a correction form, and the approval of consolidation changes (shown as not available until consolidation is part of the build). Pages are rendered on the server from the use cases of `@liasse/core/api`, run no script and escape everything read from documents. `UI_PASSWORD` accepts a plain value or an argon2id hash in PHC form, refused at startup when it cannot be read; the session cookie is `HttpOnly`, `SameSite=Strict`, and `Secure` when `PUBLIC_URL` is https; every form carries a CSRF token; at most 5 login attempts per minute per client address.
