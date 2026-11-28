# @liasse/mcp

## 0.3.0

### Minor Changes

- e9f55f6: The documents flagged for review because of how their type was decided can have it decided again in one action: `POST /documents/reclassify` with `reason` (`type_untyped` or `type_fallback`, `TYPE_REVIEW_REASONS` of `@liasse/contract/domain`) and an optional `limit` (100 at most, and by default), the MCP tool `reclassify_flagged_documents` and `reclassifyFlaggedDocuments` of the SDK, all over the use case `reclassifyFlaggedDocuments` of `@liasse/core/api`. The oldest `needs_review` documents with that reason, private ones included, are each queued as `reclassify_document` queues one, under the row lock of the document; one with a processing, re-extraction or reclassification pending is skipped, and so is one that no longer has the reason once locked. One whose last reclassification was refused with a type refusal (`private_document`, `invalid_proposal`) is left out, so that repeated requests reach the documents never tried. With `type_fallback`, the closest type of each document joins its rejected types. The answer is 202 with the counts `queued`, `skipped`, `refused` and `remaining` (left beyond `limit`). The review queue of the web UI has a button, "Analyse untyped documents again", that asks for it after a confirmation: it is the way to file the documents a daily quota of new types, since removed, left untyped (`quota_exceeded`). `requestReclassification` of `@liasse/core/pipeline` takes `onlyIf`, what the document must still be under its row lock.

### Patch Changes

- f9a21b9: The error codes of the API are one enumeration of `@liasse/contract`: `API_ERROR_CODES`, with `ApiErrorCode`, and the kind of each code (`apiErrorKindOf`, `API_ERROR_KINDS`), which decides its HTTP status. The codes of the type registry (`REGISTRY_ERROR_CODES`, from `@liasse/contract/registry`) are among them, and the codes `invalid_correction` lists its refused values with are `CORRECTION_ERROR_CODES`. The error body schema takes no other code, so its `code` is typed, and so is `code` of `LiasseApiError`; the SDK exports `API_ERROR_CODES` and `ApiErrorCode`. An error body with a code the contract does not list now rejects with `LiasseResponseError`, as an answer of a server of another version, whose message names the code and the request id and whose `cause` is the validation error. In `@liasse/core/api`, `ApiError` takes its code first and derives its kind from it, and `API_ERROR_KINDS` and `ApiErrorKind` moved to the contract. `CORRECTION_ERROR_CODES` is no longer exported by `@liasse/core/pipeline` and `RegistryErrorCode` no longer by `@liasse/core/registry`: import them from `@liasse/contract` and `@liasse/contract/registry`. The code `invalid_file` is gone: no refusal of ingestion answered it, every one has its own code. `IngestError` of `@liasse/core/ingest` is now abstract: every refusal is one of its subclasses.
- 0c7ca6e: A Google Drive source reads one folder and its subfolders through the operator's own Google OAuth client, its files kept by reference: Liasse stores their text and knowledge, Drive their bytes. The settings gain a `google` section (`client_id`, `client_secret`, sealed in a slot of its own). `POST /sources/:id/google/authorize` answers the consent page of Google (`drive.readonly`, offline, PKCE, `state` bound to the session) `GET /sources/google/callback` hands Google's answer to the page `/ui/sources/google`, and `POST /sources/google/complete` (session cookie) seals the refresh token in the source; deleting the last Drive source revokes its token. Runs list the tree, then read `changes.list` from a saved page token, with shared drives; native Google files are left out and shortcuts are followed once. `documents.storage_key` may be null (`file_at_source`), and `document_origins` gain `checksum` and `removed_at`. `GET /documents/:id/file` and the signed URLs of MCP stream such a file from Drive once its `md5Checksum` matches, and answer the new codes `file_changed` (409) and `file_unavailable` (410, of the new kind `gone`). A changed file becomes a new document and the old one is deleted, and brought back if the file returns to its bytes (`replaced_by_source`); a file trashed, deleted or moved out keeps its document, marked removed, until it is restored. A stored copy always wins over a reference. The summary of a run counts `removed` and `replaced`, and a source without credentials is not run until it has some. `SourceChange` of the connector port may carry `removed`, a `SourceItem` a `reference`, and a connector `openFile` and `forget`; `SOURCE_CONNECTORS` is replaced by `createSourceRuntime`, and `ApiContext` and `PipelineDeps` take `sourceFiles`.
- a11e836: `reclassify_document` (`POST /documents/:id/reclassify`) remembers every type a person rejected for a document: the type of each request joins those of the earlier ones, and none of them is offered again, so two requests in a row no longer bounce between two wrong types. The list is emptied when a person sets the type by hand (`update_document`, `PATCH /documents/:id` with a type), and a type merge carries a rejected source over to its target. Migration `0021` adds the column `documents.rejected_type_ids`. A reclassification queued before the upgrade and still pending runs with no remembered rejection.
- a0b4beb: The pipeline no longer bounds the new document types it creates per day. A first import on an empty registry used to create five types, then leave every other document without a type, in `needs_review`. A new type starts `provisional`, and consolidation promotes or merges it.
  
  Breaking: the setting `pipeline.max_new_types_per_day` is removed, and `PUT /settings` refuses it. Migration `0024` removes it from the saved settings. The registry no longer refuses with `quota_exceeded`, so `POST /types` never answers it. `MAX_NEW_TYPES_PER_DAY` is no longer refused at startup: it has no effect. The refusal `quota_exceeded` stays in `review.type.refusal` and the `type_refusal` of `classification` events for documents classified before, and nothing assigns it any more. `reclassify_document` (`POST /documents/:id/reclassify`) files such a document, one at a time.
- Updated dependencies [f9a21b9]
- Updated dependencies [5044a53]
- Updated dependencies [9ef56a7]
- Updated dependencies [a5151ed]
- Updated dependencies [0c7ca6e]
- Updated dependencies [74124b6]
- Updated dependencies [b57ee4b]
- Updated dependencies [e9f55f6]
- Updated dependencies [a11e836]
- Updated dependencies [a0b4beb]
- Updated dependencies [e4cbd7a]
  - @liasse/contract@0.3.0
  - @liasse/core@0.3.0

## 0.2.0

### Minor Changes

- 57b9e49: A document in `needs_review` says what to review. `GET /documents/:id?include=review` and `get_document` return a `review` part: the current threshold, the reasons the document is flagged (`low_confidence`, `type_pending_extraction`, `type_fallback`, `type_untyped`, `reextraction_failed`, `flagged_at_settlement`, `rejected_values`), and how sure the pipeline is of its type and of each core value and field, with the page and quote it was read from.
  
  A correction (`PATCH /documents/:id`, `update_document`) takes `confirm`, the core values or fields that are right as they are, each with the value it was read with: a confirmation never rewrites the value, makes it manual and clears `needs_review` like a correction. A value that changed since it was read refuses the correction with `value_changed`.
  
  The web UI shows a flagged document with a "To review" card: the reasons in sentences, the type to accept or change, and each doubtful value to accept, reject or edit, sent as one correction; a change of type leaves the fields to the extraction for the new type.
- 3e9b8c4: A correction (`PATCH /documents/:id`, `update_document`) can set or clear `core.key_dates`, where it answered `unsupported_field`. The list given replaces the key dates of the document in its core and in what `upcoming` answers, in one transaction, and a later extraction keeps it. Each date is a `kind`, a `date` and a `label` of at most 200 characters, each kind once per date and at most 50 dates. The notice deadline of a renewal date is still computed from the notice period the document states: a `notice_deadline` given next to a renewal date of such a document is refused (`invalid_value`). `upcoming` no longer flags as `computed` a date a person gave. `key_dates` still cannot be confirmed; the refusal now says to give the dates in `core.key_dates` instead.
  
  The notice period an extraction reads is now stored with the document (migration `0020`): a document extracted before this version gets no notice deadline for the key dates a person gives until it is extracted again.
- 3e9b8c4: The `review` part of a document (`GET /documents/:id?include=review`, `get_document` with `include: ["review"]`) names the values the last extraction dropped: `rejections` lists them by `section` (`core`, `fields`, `extra`, `facts`, `subjects`, `notice_period`), `name`, `reason` (`malformed`, `quote_not_found`, `quote_not_stating_value`, `invalid_value`, `invalid_key`, `duplicate_of_field`, `over_limit`, `unresolved_entity`, `sensitive_identifier`, `identifier_not_in_text`) and `count`, never the value or its quote. A document extracted before this change has only its `rejected_values` count, and an empty `rejections`.
  
  The extraction prompt says what each core field holds: `core.amount` is only an amount due, invoiced or paid, never a share capital, a payroll or a coverage limit, and a field for a place of issuance, a registry or an authority is not filled with the address of a registered office, an establishment or the recipient. A value the model puts in `extra` under the name of an empty field of the type is now read as that field, where it was dropped.
- c5747d8: MCP gains the surface REST had alone. Agents manage types: `create_type` creates a provisional type by hand, `suggest_type` drafts one with the text model, `request_consolidation_run` asks for a consolidation run and `list_consolidation_runs` follows the latest ones. They also list documents (`list_documents`, with the filters of `GET /documents`, the `needs_review` queue included), read the whole processing log of a document (`list_document_events`), delete a document (`delete_document`) and list subjects (`list_subjects`). Each tool calls the use case of its REST route and answers the same thing.
- 3e9b8c4: Classification no longer files a document under an unrelated type. The model reuses a candidate only when it truly describes the document, and proposes a new type otherwise. A new type that cannot be created (daily quota reached, private document with an external embedder, proposal refused twice) leaves the document without a type, in `needs_review`, instead of giving it the closest candidate with a confidence of 0: the type provenance and the `review` part say why in `refusal` (`quota_exceeded`, `private_document`, `invalid_proposal`, `rejected_type`), and the `classification` event in `type_refusal`. The outcome `fallback` is no longer assigned; documents classified before keep it.
  
  `reclassify_document` (`POST /documents/:id/reclassify`) whose new type cannot be created changes nothing: the document keeps its type, values and status, and a failed `classification` event carries the reason as its `error_code`. With `new_type`, a slug that names another existing type is refused instead of taken.
  
  The description of the MCP tool `create_type` says it is the way to file such a document: it is outside the daily quota of classification, and `update_document` then sets the type. The web UI says why a document has no type.
- 8b07058: Require Node 22.12 or later on the 22 line, 24.22.3 or later on the 24 line, or 26.5.1 or later. Earlier Node 24, 25 and 26 releases bundle an undici whose `fetch` can throw an uncaught `EINVAL` from `setTypeOfService` on macOS when a new connection is reset, which ends the process (nodejs/undici#5547). The server now refuses to start on such a Node, with a message that names the supported versions. `@liasse/contract` and `@liasse/sdk` keep Node 22.12 or later.
- 6910894: The type of a settled document can be decided again when the one it got is wrong: `POST /documents/:id/reclassify` answers 202 with the document, the MCP tool `reclassify_document` does the same, and the SDK has `reclassifyDocument`. The request may carry a `hint` (cut to the length of an upload hint) and `new_type`, which asks for a new type only. A `reclassify_document` job asks the model again without the rejected type, tells it that a person said that type is wrong and what they added, then changes the type as a manual correction does, with the provenance of the model, and queues the re-extraction that settles the document. A document that is not `indexed` or `needs_review`, or has a processing, re-extraction or reclassification pending, is refused (`document_not_settled`); an unknown or deleted one is not found. The hint waits on the document (`documents.reclassification_hint`, blanked by a deletion), never in the job. `@liasse/contract` now holds the definitions of the core fields (`CORE_FIELDS`, `CORE_FIELD_NAMES`, `KEY_DATES_FIELD` in `/registry`, no longer exported by `@liasse/core/registry`) and `SETTLED_STATUSES` (in `/domain`), and the edit tab of the web UI edits every core field with the editor of its definition, filled or not, and chooses the type of a document by hand, as a correction.
- 3e9b8c4: The values of a settled document can be extracted again for the type it has, without changing or deciding its type again: `POST /documents/:id/reextract` answers 202 with the document, the MCP tool `reextract_document` answers its id and status, and the SDK has `reextractDocument`. The request queues the `reextract_document` job under the row lock of the document, with the refusals of a reclassification (`document_not_settled` for a document on its way, failed, or with a processing, re-extraction or reclassification pending); values corrected or confirmed by hand are kept. `retry_document` is unchanged and still refuses any document that did not fail.
  
  Where processing stands is visible while a document is still `received` with no event in its log: `get_status` now also answers `analysis_pending`, `updated_at` and `job`, the processing job queued or running for the document (`kind`, `state`, `attempts`, `max_attempts`, `queued_at`, `run_after`, and for a queued one `waiting_for`, `worker` with `jobs_ahead` or `delay`). `GET /documents/:id/status` and the SDK's `getDocumentStatus` answer the same, from the use case `getDocumentStatus` of `@liasse/core/api`; `@liasse/contract` has `documentStatusSchema`, `DOCUMENT_STATUS_EVENTS`, `UNFINISHED_JOB_STATUSES` and `JOB_WAITS`.
  
  The description of the MCP tool `list_documents` says that with `status: needs_review` it is the review queue of documents. The descriptions of `list_pending_changes` and `apply_change` now say they are about the type registry and point to it, those of `retry_document`, `reclassify_document` and `reextract_document` say which one to use when, and that of `ingest` asks for `private: true` on sensitive documents and explains the `received` interval.
- 6ba9355: `GET /documents/:id` and `get_document` answer `analysis_pending`: whether a processing, re-extraction or reclassification of the document is queued or running, while its status stays `indexed` or `needs_review`.
  
  The web UI asks for the type to be analysed again from the review of a `needs_review` document, as a third choice for its type next to Accept and Change, with an optional hint; the model creates a new type when none fits, without a checkbox. The document page follows a pending analysis from `analysis_pending`, so a reload or leaving the page no longer loses it, and says how it ended: with the new type, failed with its code, or left alone because the document changed first.
- 2f21931: The settings live in the database and apply without a restart. The language models and their key, the embedder, the pipeline and Hindsight are one document saved with `PUT /settings`, read with `GET /settings` and tried without saving with `POST /settings/check` (`getSettings`, `saveSettings` and `checkSettings` of the SDK), with the session of the web UI only, never an API key. Keys are encrypted at rest under a key derived from `AUTH_SECRET` and never answered; after a change of `AUTH_SECRET` they are reported `unreadable`, and a save replaces or clears them. Every process on the database, MCP over stdio included, follows a save through `LISTEN`. A save applies at once: jobs in progress finish with the models they started with. The embedder can no longer change once a document exists.
  
  Breaking: `LLM_PROVIDER`, `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_TIMEOUT`, `TEXT_MODEL`, `VISION_MODEL`, `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, `EMBEDDING_API_KEY`, `EMBEDDING_BASE_URL`, `EMBEDDING_TIMEOUT`, `EMBEDDING_MAX_INPUT_TOKENS`, `MAX_FILE_SIZE`, `AUTO_APPLY`, `CONFIDENCE_THRESHOLD`, `MAX_NEW_TYPES_PER_DAY`, `SCHEMA_LANGUAGE`, `MAX_VISION_PAGES`, `ENTITY_ATTACH_SIMILARITY`, `ENTITY_ARBITRATION_SIMILARITY`, `HINDSIGHT_URL`, `HINDSIGHT_BANK` and `HINDSIGHT_API_KEY` are no longer read: the server refuses to start while one is set, and names it. Remove them from `.env` and save their values as settings (`docs/deployment.md`, Upgrading from environment variables). Until they are saved, the server serves the web UI, runs no worker and answers `503 not_configured` on the routes of the API. `pnpm eval:run` and `pnpm eval:calibrate` take their models from a JSON file of settings, `--settings <file>`.

### Patch Changes

- 3f5ac25: The description of `list_pending_changes` no longer promises splits and renames of types: consolidation proposes neither.
- 3f5ac25: `upcoming` takes `include_private`, as its MCP description already said: the key dates of private documents are left out unless it is true, on MCP and on `GET /upcoming` alike. An agent that passed it before got a validation error.
- Updated dependencies [57b9e49]
- Updated dependencies [7db033b]
- Updated dependencies [3e9b8c4]
- Updated dependencies [12f6a23]
- Updated dependencies [3e9b8c4]
- Updated dependencies [16fa6f7]
- Updated dependencies [69d6c97]
- Updated dependencies [3e9b8c4]
- Updated dependencies [8b07058]
- Updated dependencies [c95f7a1]
- Updated dependencies [6910894]
- Updated dependencies [3e9b8c4]
- Updated dependencies [b14baf7]
- Updated dependencies [6ba9355]
- Updated dependencies [8282534]
- Updated dependencies [2f21931]
- Updated dependencies [8bb948c]
- Updated dependencies [0212ac4]
- Updated dependencies [3f5ac25]
  - @liasse/contract@0.2.0
  - @liasse/core@0.2.0

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
