# @liasse/mcp

## 0.1.0

### Minor Changes

- 354ebc9: Lay the foundation: validated configuration, the Postgres schema and migrations for the eleven tables, model ports with deterministic fakes, the untrusted-content prompt helper and a server exposing `GET /health`.
- ff7a0b5: Add the MCP server (`@liasse/mcp`): the fourteen tools of the specification and the `doc://{id}` and `types://` resources, over the use cases of `@liasse/core/api` that REST calls. The server mounts it on `/mcp` (Streamable HTTP, stateless, behind the credentials of the API) and serves it on the standard streams with `--stdio`, exiting when its input ends. Tool descriptions flag document content as untrusted; failures carry the error codes of REST, `not_implemented` standing for its 501. `ingest` takes a base64 file; `url` answers `not_implemented` for now. `@liasse/core/api` gains the `timeline`, `recall` and `getSubject` use cases, which the server binds to the knowledge layer like `upcoming`, `idSchema`, `CORRECTED_PARTS`, `toApiError` and `invalidRequest`; `@liasse/core/db` exports `sqlStateOf`.
- 02ab8b1: Each document keeps a processing log: every stage that succeeded and every attempt of its jobs that failed, with the stage, the status, the attempt, the error code and class, whether it is retried, the model, and counts such as the values the model returned that were rejected. Nothing read from the document is logged. The 100 most recent events are kept per document and removed with it.
  
  `GET /documents/:id/events` answers the log, the SDK reads it with `listDocumentEvents`, the MCP tool `get_status` adds it as `events`, and the document page of the web UI shows it in a Processing tab. A re-extraction or a re-indexing that fails in a way another attempt cannot fix now ends its job at once, as `process_document` did.
- 47ba878: A failed document can be processed again without uploading its file: `POST /documents/:id/retry` answers 202 with the document queued from the start, the MCP tool `retry_document` does the same, and the SDK has `retryDocument`. Both refuse a document that did not fail (`document_not_failed`) and an unknown or deleted one (`document_not_found`). A retry gives the watched folder its tries back, as an upload of the same bytes does. The document page of the web UI shows a Retry button on a failed document.
- 3b95f94: Every key on the wire is snake_case. The knowledge answers that were camelCase are renamed: `documentCount` is `document_count` in `GET /subjects` and `get_subject`, `nextDates` is `next_dates` in `get_subject`, and the facts of `timeline` and `recall` carry `valid_from`, `valid_to` and `document_id`, plus `entity_ids` and `subject_ids` in `recall`. The SDK types follow, since they are those of `@liasse/core/contract`. A test of the contract fails on any key of a request or an answer that is not snake_case.

### Patch Changes

- 7c4ca7d: Move the contract into its own package, `@liasse/contract`, which depends on `zod` alone. Installing `@liasse/sdk` no longer installs `@liasse/core` and its server dependencies (Postgres, the ONNX runtime, the AI SDK, pdfjs): the SDK depends on `@liasse/contract` and `zod` only. The root entry holds the schemas and types of every request and answer, formerly `@liasse/core/contract`, which is removed. The pure modules they are built from move with them and are no longer exported by `@liasse/core`: enumerations, shared schemas, values, limits, languages and currencies are in `@liasse/contract/domain` (formerly in `@liasse/core/domain`), the query DSL and its errors in `@liasse/contract/query`, field primitives and `Result` in `@liasse/contract/registry`, entity list options in `@liasse/contract/entities` and the search input in `@liasse/contract/search`.
- Updated dependencies [edaa336]
- Updated dependencies [01cc23c]
- Updated dependencies [d4503fb]
- Updated dependencies [d91c225]
- Updated dependencies [e2b7064]
- Updated dependencies [7c4ca7d]
- Updated dependencies [2e9decd]
- Updated dependencies [018bd6f]
- Updated dependencies [d3ba5e5]
- Updated dependencies [c3665e3]
- Updated dependencies [42ae909]
- Updated dependencies [354ebc9]
- Updated dependencies [d0a82db]
- Updated dependencies [1251350]
- Updated dependencies [03482cf]
- Updated dependencies [28e5c9d]
- Updated dependencies [14d3f24]
- Updated dependencies [ff7a0b5]
- Updated dependencies [faa8bc9]
- Updated dependencies [47cc651]
- Updated dependencies [027f193]
- Updated dependencies [02ab8b1]
- Updated dependencies [55ec70b]
- Updated dependencies [08bbea2]
- Updated dependencies [bcf30ea]
- Updated dependencies [47ba878]
- Updated dependencies [a7ccb4a]
- Updated dependencies [3b95f94]
- Updated dependencies [2eb4f51]
- Updated dependencies [4b7c202]
- Updated dependencies [1e5abde]
- Updated dependencies [c0a2f44]
- Updated dependencies [76f76b4]
- Updated dependencies [ccd3c27]
- Updated dependencies [9ba86d3]
  - @liasse/core@0.1.0
  - @liasse/contract@0.1.0
