---
'@liasse/contract': minor
'@liasse/core': minor
'@liasse/sdk': minor
'@liasse/mcp': patch
'@liasse/server': patch
---

Move the contract into its own package, `@liasse/contract`, which depends on `zod` alone. Installing `@liasse/sdk` no longer installs `@liasse/core` and its server dependencies (Postgres, the ONNX runtime, the AI SDK, pdfjs): the SDK depends on `@liasse/contract` and `zod` only. The root entry holds the schemas and types of every request and answer, formerly `@liasse/core/contract`, which is removed. The pure modules they are built from move with them and are no longer exported by `@liasse/core`: enumerations, shared schemas, values, limits, languages and currencies are in `@liasse/contract/domain` (formerly in `@liasse/core/domain`), the query DSL and its errors in `@liasse/contract/query`, field primitives and `Result` in `@liasse/contract/registry`, entity list options in `@liasse/contract/entities` and the search input in `@liasse/contract/search`.
