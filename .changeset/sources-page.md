---
'@liasse/sdk': minor
'@liasse/web': minor
---

A Sources page in the web UI: one card per ingestion source with its last run (counts, skipped items and why, the error that stopped it), whether its password was refused or no longer opens, a switch to enable it, and buttons to run it now, check it, edit it and delete it. The form of an IMAP source is validated with the schemas of the contract, keeps the stored password unless it is replaced, warns when the connection has no encryption, and explains how to read Gmail through an app password.

The SDK gains `listSources`, `createSource`, `getSource`, `updateSource`, `deleteSource`, `checkSource` and `runSource`, which take the session of the web UI like the settings.
