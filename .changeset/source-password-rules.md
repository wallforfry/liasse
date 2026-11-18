---
'@liasse/contract': patch
'@liasse/core': patch
'@liasse/sdk': patch
'@liasse/web': patch
---

An enabled source needs a password that opens: `POST` and `PATCH /sources` refuse one left without a password, cleared or never set, or with a stored one sealed under another `AUTH_SECRET` (400 `source_secret_required`). The switch of the Sources page shows that refusal, and the form says it before saving.

`checkSource` of the SDK waits longer than the server bounds a check (`SOURCE_CHECK_TIMEOUT_MS` of `@liasse/contract/domain`), so it receives the answer of a check that ran out of time instead of aborting first; the IMAP connector stays under that bound while it logs out. The form of a source sends only the fields it changed: a save in another tab to the other fields stays.
