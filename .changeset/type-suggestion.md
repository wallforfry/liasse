---
'@liasse/contract': minor
'@liasse/core': minor
'@liasse/sdk': minor
'@liasse/server': minor
'@liasse/web': minor
---

A type can be drafted by the text model. `POST /types/suggestion` (`suggestType` of the SDK) takes a sentence on the documents the type is for and answers with a slug, a description, a parent and fields, without creating anything.

The "Create a type" dialog of the web UI has two tabs: "Describe it", where the text model drafts the type from a sentence, and "Define it", the form, which the draft fills for review before the type is created.
