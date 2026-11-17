---
'@liasse/contract': minor
'@liasse/core': minor
'@liasse/sdk': minor
'@liasse/server': minor
'@liasse/web': minor
---

The models of a provider can be listed from the settings. `POST /settings/models` (`listSettingsModels` of the SDK) takes the endpoint of the language models or of a remote embedder as the form holds it, with the stored key when the key is kept, and answers the ids the provider lists, or why it listed none.

On the settings page, each model field has a button that opens this list, searchable, next to the input, which still takes any id typed by hand.
