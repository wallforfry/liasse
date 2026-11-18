---
'@liasse/contract': minor
'@liasse/core': minor
'@liasse/sdk': minor
'@liasse/mcp': patch
'@liasse/server': patch
---

The error codes of the API are one enumeration of `@liasse/contract`: `API_ERROR_CODES`, with `ApiErrorCode`, and the kind of each code (`apiErrorKindOf`, `API_ERROR_KINDS`), which decides its HTTP status. The codes of the type registry (`REGISTRY_ERROR_CODES`, from `@liasse/contract/registry`) are among them, and the codes `invalid_correction` lists its refused values with are `CORRECTION_ERROR_CODES`. The error body schema takes no other code, so its `code` is typed, and so is `code` of `LiasseApiError`; the SDK exports `API_ERROR_CODES` and `ApiErrorCode`. An error body with a code the contract does not list now rejects with `LiasseResponseError`, as an answer of a server of another version. In `@liasse/core/api`, `ApiError` takes its code first and derives its kind from it, and `API_ERROR_KINDS` and `ApiErrorKind` moved to the contract.
