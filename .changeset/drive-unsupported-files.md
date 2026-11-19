---
'@liasse/core': patch
'@liasse/server': patch
---

A Google Drive source no longer downloads the files no supported format could be: a file is taken when the type Drive lists it with or the extension of its name is one of a PDF, a JPEG, PNG or HEIC image, a DOCX document or an email (`mayBeSupported` of `@liasse/core/formats`, derived from `SUPPORTED_MIMES`). Videos, archives, executables and files without a known extension are left out of the run and of its skipped items, as Google's own types already were. A download Drive refuses for that one file (403 `cannotDownloadAbusiveFile`, `cannotDownloadFile`, `insufficientFilePermissions` or `appNotAuthorizedToFile`) now skips the item with its reason instead of ending the run, and serving such a file answers `file_unavailable`; a limit that lifts on its own (429, or 403 `userRateLimitExceeded`, `rateLimitExceeded` or `downloadQuotaExceeded`) still ends the run for the retries of the queue, and every refusal now names Drive's reasons.
