# Ingestion sources: study

Status: decided, not implemented. Date: 2026-11-18. The decisions are recorded in the decision table of the spec (`docs/spec.md`); section 7 lists them.

Question: can Liasse ingest from several sources configured in the web UI (an FTP or SFTP folder under watch, Gmail attachments, a Google Drive), and can a Drive be ingested without keeping a second copy of its files in our storage?

Short answer: yes for the three sources, on one shared mechanism that does not exist yet. The Drive "by reference" mode is feasible because only two places read a stored file, but it changes a founding rule of the spec (files are ours, addressed by their hash) and brings a drift problem that has to be decided, not coded around.

Facts about the current code carry a `path:line`. Facts about Google and the protocols come from their public documentation as known at the time of writing and are marked _to verify_ where a detail decides the design.

## 1. What exists today

| Concern           | Today                                                                                                                                                                                                                                                                                                |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entry point       | `ingestFile({db, storage, maxFileSize}, {bytes or stream, filename, source, hint?, private?, revivesDeleted?})` (`packages/core/src/ingest/ingest-file.ts:16`). It accepts a stream, so a remote download can feed it directly.                                                                      |
| Dedup             | Global by sha256, `documents.sha256` is UNIQUE (`packages/core/src/db/schema/documents.ts:33`). Same bytes from two sources give one document.                                                                                                                                                       |
| Origin            | `source` enum `['watch','api','mcp']` (`packages/contract/src/domain/enums.ts:131`) and `original_name`. No source instance, no remote id, no path.                                                                                                                                                  |
| Watched folder    | One local directory from `WATCH_DIR` (env, `packages/core/src/config/process-sections.ts:16`), `fs.watch` plus a rescan every 60 s. Its state is in memory only (`packages/core/src/ingest/watch-files.ts:72`): after a restart every file is read and hashed again.                                 |
| Storage           | Port `put/get/getStream/exists/delete/check` (`packages/core/src/storage/port.ts:4`), keys derived from the hash only (`packages/core/src/storage/key.ts`), drivers `fs` and `s3`, configured by env.                                                                                                |
| Readers of a file | Two: the text stage of `process_document` and its retry (`packages/core/src/pipeline/text-stage.ts:66`), and `GET /documents/:id/file` (`packages/core/src/api/document-file.ts:19`), used by the UI and the signed URLs of MCP. Re-extract, reindex and reclassify read the database, not the file. |
| Deletion          | Tombstone keeps `sha256` and `storage_key`, then a `delete_file` job removes the blob (`packages/core/src/ingest/delete-file-job.ts:36`). The tombstone stops a file still in the watched folder from coming back (spec:100).                                                                        |
| Emails            | An `.eml` is a document; its non-inline attachments become documents of their own with an `attachment_of` link (`packages/core/src/pipeline/attachments.ts:23`). Attachments never revive a tombstone.                                                                                               |
| Settings          | One row, sections `llm`, `embedding`, `pipeline`, `hindsight`, edited from the UI with the session cookie only. Keys are sealed with AES-256-GCM under a key derived from `AUTH_SECRET`, in a fixed list of slots (`packages/core/src/settings/keys.ts:5`).                                          |
| Jobs              | Postgres queue with retries and backoff. No cron: a recurring job reschedules itself, as `consolidate` does (`packages/core/src/consolidation/schedule.ts:16`).                                                                                                                                      |
| Outbound OAuth    | None. better-auth makes Liasse an authorization server for MCP clients, never a client of Google.                                                                                                                                                                                                    |
| Public URL        | `publicUrl` exists in the configuration (`packages/core/src/config/public-url.test.ts`), which an OAuth redirect URI needs.                                                                                                                                                                          |
| Spec scope        | Single user (spec:23). Out of the MVP: "Ingestion by email address (IMAP)" (spec:37-44). No mention of Gmail, Drive, FTP or connectors.                                                                                                                                                              |

The Hindsight integration is the nearest precedent: configured from the UI, key in a sealed slot, its own job kind, a startup sweep, rebuilt when settings change (`packages/core/src/hindsight/integration.ts:60`).

## 2. Shared mechanism: sources

The three sources share one shape: list what is new since a cursor, download it, hand it to `ingestFile`, remember what was handled. Building that once, then one connector per protocol, is the bulk of the work. The connectors themselves are small.

### 2.1 Data model

- **`ingestion_sources`**: `id` (`src_<ULID>`), `kind` (`sftp`, `ftp`, `imap`, `gmail`, `gdrive`, from an `as const` list in `@liasse/contract`), `name`, `enabled`, `config` jsonb (a Zod schema per kind, discriminated on `kind`), `secret` (sealed), `cursor` jsonb, `last_run_at`, `last_error`, `created_at`. A table rather than a section of `settings`: there may be several sources of one kind, each with its own credentials and state, and the settings row is a singleton with fixed slots.
- **No item history.** A source keeps a cursor, nothing per message or per file. IMAP and Drive both have a native cursor (section 3), and the sha256 dedup with its tombstones already makes a re-read harmless. Only FTP and SFTP lack a cursor; they would need a listing state of their own (section 3.1), which is why they come after IMAP.
- **`document_origins`**: `document_id`, `source_id`, `external_id`, `name`, `first_seen_at`. Because dedup is global, one document may come from Drive and from a Gmail attachment at once; a single `source` column cannot say so. `documents.source` gains one value, `connector`, and the detail lives here. The table references `documents`, so it joins `DOCUMENT_REFERENCES` (`packages/core/src/ingest/delete-document.ts:66`), and a source id joins nothing outside this table.

### 2.2 Secrets

The secret box takes a slot name as additional data (`packages/core/src/settings/secret-box.ts`). A source seals its secret with `source:<id>` as that data, which binds a sealed value to its row: copying one source's secret onto another fails to open. The API exposes `set | unset | unreadable` and `keep | replace | clear`, as settings do. Rotating `AUTH_SECRET` makes them `unreadable`, as it already does for the model keys.

### 2.3 Running a source

- One job kind, `source_poll`, payload `{sourceId}`, which reschedules itself after its interval (default 5 min for remote sources) as `consolidate` does, under an advisory lock per source so that two workers never poll one source.
- Each run: list changes since `cursor`, then for each new item in order download it as a stream, call `ingestFile` with `source: 'connector'`, record the origin, and advance the cursor past it. A crash re-reads at most the item in progress, which the dedup absorbs.
- An item that fails for good (unsupported format, over the size limit, malformed) is skipped: the cursor moves past it and the run records the skip in the source's last-run summary. An item that fails transiently (network, server) stops the run without moving the cursor, so the next run starts from it. Without an item history, a skipped item is not retried later.
- A per-kind concurrency cap, like `hindsight_sync`, so a large first import of a Drive does not starve `process_document`.
- Errors split in two: a credential error (revoked token, wrong password) disables polling and shows the source as needing attention in the UI; a transient one goes through the normal backoff.
- Enabling, disabling or editing a source enqueues or cancels its job; a startup task seeds the jobs of enabled sources, as `consolidate` is seeded.

### 2.4 Tombstones and removal upstream

- A document deleted in Liasse stays deleted when its source lists it again: the tombstone already wins for the watched folder and for attachments (`revivesDeleted: false`), sources follow the same rule.
- A file removed upstream does not delete the document, as for the watched folder. In reference mode (section 4) this is no longer true and needs a decision.
- Liasse never writes to a source: no move, no delete, no "mark as read". Read-only scopes make this hold by construction for Google.

### 2.5 API and UI

- REST `GET/POST /sources`, `GET/PATCH/DELETE /sources/:id`, `POST /sources/:id/check` (tests the credentials and lists a few items), `POST /sources/:id/run` (polls now), `GET /sources/:id/items` (what was taken, skipped, failed and why). Session cookie only, like `/settings`, since they hold credentials. Whether MCP gets read-only `list_sources` is a separate choice.
- Web UI: a "Sources" page with one card per source (kind, name, last run, counts, error), a form per kind built from its Zod schema, and a "Connect with Google" button for the Google kinds.
- `WATCH_DIR` stays an environment variable. The onboarding design records the local folder as a process resource (`docs/superpowers/specs/2026-11-17-onboarding-and-settings-design.md:41`), and letting the UI name an arbitrary path on the server is a way to read its file system. It may be shown read-only on the Sources page.

### 2.6 Filters

Every source needs the same few filters, applied before download: extensions or MIME types, maximum size (already enforced by `ingestFile`), and an optional `hint` and `private` flag applied to everything the source ingests. Kind-specific filters live in its config (a Gmail query, a Drive folder, a remote path).

## 3. The connectors

### 3.1 FTP, FTPS, SFTP

- No change notification in either protocol: polling only. Each run lists the configured directory (recursively, bounded depth), compares `(path, size, mtime)` with the listing of the previous run, kept as the source's state, and downloads what changed. That listing is the one exception to "a cursor only": neither protocol offers anything narrower. The stability rule of the watcher (unchanged across two listings, temporary names ignored, `packages/core/src/ingest/watch-files.ts:8`) applies as is and should be shared rather than copied.
- SFTP over SSH should be the default. Plain FTP sends the password in clear; offer it only with explicit TLS (FTPS) or behind a warning. SFTP needs the host key pinned at creation (shown to the user on first connection, stored in `config`), otherwise the first connection trusts anyone.
- Credentials: password or private key, sealed.
- Dependencies: `ssh2-sftp-client` (or `ssh2` directly) and `basic-ftp`. Node has neither protocol. Two dependencies, both maintained, both pure JS apart from optional native crypto in `ssh2`; worth confirming before adding.
- The host is chosen by a signed-in user, so the server will connect wherever it is told, internal network included. For a single-user, self-hosted service this is the intended use, but it belongs in `SECURITY.md`.

### 3.2 Gmail

Two routes, very different in cost.

|                   | IMAP with an app password                                                   | Gmail API with OAuth                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Setup by the user | Enable 2-Step Verification, create an app password, paste it                | Create a Google Cloud project, an OAuth client, paste its id and secret, consent                                                                                                                                                                                                                                                                                                                            |
| Works with        | Any mailbox (Gmail, Fastmail, Outlook.com, self-hosted)                     | Gmail only                                                                                                                                                                                                                                                                                                                                                                                                  |
| Incremental       | `UIDVALIDITY` + last `UID`; Gmail labels through `X-GM-LABELS` / `X-GM-RAW` | `history.list` from a `historyId`                                                                                                                                                                                                                                                                                                                                                                           |
| Filter            | IMAP `SEARCH`, or Gmail search syntax through `X-GM-RAW`                    | Gmail search syntax (`has:attachment label:invoices`)                                                                                                                                                                                                                                                                                                                                                       |
| Google review     | None                                                                        | `gmail.readonly` is a restricted scope (_to verify_ current rules). Each operator runs their own client, so no review is needed for personal use, but a client left in "Testing" status gets refresh tokens that expire after 7 days; moved to "In production" without verification it shows a warning screen and works up to 100 users. A Workspace account can mark the client "Internal" and avoid both. |
| Dependency        | `imapflow`                                                                  | `googleapis` or plain `fetch` on the REST endpoints                                                                                                                                                                                                                                                                                                                                                         |

Decision: IMAP first. It covers Gmail and every other provider, needs no OAuth flow, and the setup is one password. The Gmail API may follow once the Google OAuth flow exists for Drive, if it proves more useful.

IMAP synchronization:

- The source names one or more mailboxes (`INBOX`, or a Gmail label such as `Invoices`, which IMAP exposes as a folder) and an optional search.
- The cursor is, per mailbox, `{uidValidity, lastUid}`. A run selects the mailbox, checks `UIDVALIDITY`, then fetches `UID lastUid+1:*` matching the search, oldest first.
- A first run must not import years of mail by surprise: the source asks for a start date, and the first run starts from the first UID at or after it (`SEARCH SINCE`).
- A changed `UIDVALIDITY` (mailbox recreated, rare) invalidates the UIDs: the run restarts from the start date. Messages already ingested are recognised by their hash and deleted ones stay deleted, so the cost is a re-download, not duplicates.
- On Gmail, a label added later to an old message puts it in that label's folder with a new, higher UID: it is picked up by the next run, which suits a "label it to file it" workflow.
- The run never sets flags or moves messages (`EXAMINE`, not `SELECT`, so `\Seen` is untouched).
- A message's hash is the hash of its raw bytes. Gmail returns the same bytes for the same message in every folder, so a message present under two watched labels is one document (_to verify_ on a real account).

What to ingest from a message:

- **The whole message as `.eml`** reuses everything: the message becomes a document, each attachment a document of its own linked by `attachment_of`, and the body's text (often where the amount and the due date are) is searchable. Gmail returns the raw RFC 822 message (`format=raw`), IMAP returns it with `BODY[]`.
- **Attachments only** matches the request literally and keeps newsletters' bodies out, but loses the link to the message and its text, and needs a second code path.
- Decision: the whole message, only when it has at least one non-inline attachment. Its body often holds what matters (an amount, a due date) and links the attachments together, and skipping messages without attachments keeps notifications and newsletters away from the models. `BODYSTRUCTURE` tells which messages have one without downloading them. A per-source option includes messages without attachments too.

Spec: the out-of-scope line "Ingestion by email address (IMAP)" now reads as receiving mail at an address of Liasse, and the decision table records that reading a mailbox over IMAP is a planned source.

### 3.3 Google Drive

- OAuth is unavoidable: there is no app-password equivalent.
- Scope choice decides the user experience (_to verify_):
  - `drive.readonly`: every file of the account, restricted scope, same "Testing" / unverified rules as Gmail.
  - `drive.file`: non-sensitive, but Liasse only sees files the user picked through the Google Picker or that Liasse created. Picking a folder does not reliably grant its future content. This fits "import these files", not "watch this folder".
  - Decision: `drive.readonly`, the only scope that sees files added to a folder later. The operator's own OAuth client must be moved to "In production" without verification (a warning screen at consent, harmless for personal use): in "Testing" status the refresh token expires after 7 days and the sync would stop every week. The setup is documented step by step.
- Incremental: `changes.getStartPageToken` once, then `changes.list` from the saved token; filter on parents to keep only the chosen folder and its subfolders. `changes.watch` would push notifications but needs a public HTTPS endpoint and channel renewal; polling every few minutes is simpler and enough.
- Files: binary files are downloaded with `files.get?alt=media`; Drive gives `md5Checksum`, `size` and `headRevisionId`, not sha256, so dedup still needs the download. Native Google Docs, Sheets and Slides have no bytes: they are exported (to PDF), the export has a size limit (_to verify_, 10 MB), and two exports of an unchanged file need not give the same bytes, so their hash is not stable. They have no `md5Checksum` either, so the drift guard of 4.3 cannot apply. Decision: excluded at first. Later they may be exported to PDF and that PDF stored by Liasse, which duplicates nothing since Drive holds no such PDF; a change is then detected by their `version`.
- Shared drives need `supportsAllDrives` / `includeItemsFromAllDrives` on every call.
- Shortcuts point to another file; follow them once, never recursively.

### 3.4 Google OAuth, shared by Gmail and Drive

- The operator supplies the client id and secret of their own Google Cloud project, in a new settings section `google` with a new secret slot (`SECRET_SLOTS` gains `google`). Liasse cannot ship a client of its own: a self-hosted instance cannot keep its secret, and Google would require a verification for the restricted scopes in Liasse's name.
- Flow: `POST /sources/google/authorize` returns the consent URL with `state` and PKCE, `access_type=offline`, `prompt=consent`; the callback `GET /api/sources/google/callback` (redirect URI built from `publicUrl`) exchanges the code and seals the refresh token in the source's secret. The `state` is bound to the signed-in session.
- better-auth's `genericOAuth` plugin is for signing users in, not for holding a third-party token per source; a small client on `fetch` (token exchange, refresh, revoke) is enough and keeps the provider out of feature code, through a port in `@liasse/core/models` style.
- Deleting a source revokes its token.

## 4. Drive without a second copy

### 4.1 Feasibility

Today every document has its bytes in our storage under `ab/cd/<sha256>`, and `storage_key` is NOT NULL. Only two consumers read them (section 1). A document can therefore have its file **in our storage** or **at a source**, if `getDocumentFile` (`packages/core/src/ingest/document-file.ts:23`), which both consumers already go through, resolves either:

- `documents.storage_key` becomes nullable, and a `remote` origin (`document_origins` row with `is_file_location`) says where the bytes are. A check constraint keeps exactly one of the two.
- `getDocumentFile` returns, for a remote document, a stream opened by the connector (`files.get?alt=media` with a fresh access token).
- `GET /documents/:id/file` proxies that stream. A redirect to Drive is not possible: the link needs the user's Google session, and the signed URLs of MCP must keep working for a client with no Google account.
- `delete_file` skips remote documents: deleting a document in Liasse never deletes the Drive file (and `drive.readonly` forbids it anyway).

The file is still downloaded once, at ingestion: Liasse must hash it (dedup), detect its type, extract its text and, for a scan, send its pages to the vision model. What is saved is storage, not transfer. Text, chunks, pages and extracted values stay in Postgres in both modes.

### 4.2 What it costs

1. **Drift.** The Drive file can change after ingestion. The text, the facts and the embeddings then describe bytes that no longer exist, and the download route serves other bytes than the ones indexed. Detection is cheap (`headRevisionId` or `md5Checksum` in the `changes` feed). The policy is not:
   - a new revision is a new document (the old one becomes a tombstone, its knowledge is lost or migrated);
   - or the document is reprocessed in place under a new hash, which `documents.sha256` UNIQUE and the tombstone rule do not allow today;
   - or the old revision is pinned with `keepForever`, which needs write access.
     The first is the only one that fits the current model.
2. **Removal upstream.** A trashed or deleted Drive file leaves a document whose file is gone. Today that state (`file_missing`, 404) is an anomaly; in reference mode it is normal, and the UI and MCP must say so. Proposal: the document stays, its knowledge stays, its file is marked unavailable.
3. **Availability.** Retry and reprocessing from the file, and every download, need Drive reachable and the token valid. A revoked token or a deleted source makes every file of that source unavailable at once. Deleting a source in reference mode must therefore either delete its documents or offer to copy their files first.
4. **Dedup across modes.** The same bytes may arrive by reference from Drive and by copy from Gmail. The rule should be: a copy always wins, and a document by reference becomes a stored one as soon as any copy mode brings its bytes.
5. **Backup.** Today a dump of Postgres plus the bucket is a complete backup (`docs/deployment.md:107`). In reference mode it no longer contains every file. To state in the deployment doc.
6. **Spec.** spec:85 says files live outside the database "addressed by their hash", and spec:315 that Liasse "never delegates storage" to Hindsight. Reference mode delegates storage to Drive: it needs an explicit entry in the decision table.

### 4.3 Decision

Drive documents are kept by reference: Liasse stores the Drive file id, never the bytes. The goal is no duplication: Drive stays the one place where those files live. Copy mode remains for IMAP and FTP, whose servers are not meant as an archive.

Drift policy: **a changed file is a new document.**

- The origin of a Drive document records the file's `md5Checksum` at ingestion. A rename or a move keeps the checksum and changes nothing in Liasse.
- When the `changes` feed reports a file whose checksum differs, the sync ingests it as a new document (new hash, new text, new knowledge), then deletes the old document through `deleteDocument`, which leaves its tombstone and cleans its derived rows and Hindsight memory as for any deletion.
- What is lost: the manual corrections and the links of the old document. They described other content and would be doubtful on the new one.
- Why not reprocess in place: it would break the UNIQUE hash of `documents`, the hash lock and the tombstone rule, for a case that is rare in an archive of PDFs and scans.
- Download guard: before streaming a Drive file, `getDocumentFile` reads its metadata and compares the checksum with the recorded one. On a mismatch it answers "file changed" (409) rather than serve bytes Liasse did not index; the change may land between two syncs. The text stage applies the same check on a retry.

Removal policy: **the document stays, its file is unavailable.**

- A file trashed or deleted in Drive, or out of the watched folder, leaves the document, its text and its knowledge in Liasse. Its origin is marked `removed` with the date, and the download answers "file unavailable at its source" (410), distinct from the `file_missing` anomaly of a stored file.
- The UI and MCP show the state. The user may delete the document; nothing deletes it automatically.
- A file restored in Drive with the same checksum clears the mark.

## 5. Alternatives considered

- **rclone in a sidecar, syncing to `WATCH_DIR`.** Zero code, covers SFTP, FTP and Drive today. But no UI, a second copy on disk on top of storage, Gmail not covered, and credentials outside Liasse. Good as a documented workaround, not as the feature.
- **Mounting Drive as a file system and watching it.** The watcher would re-hash every file after each restart, as it does today, which on a network mount means re-downloading the whole Drive.
- **Push instead of polling** (Gmail Pub/Sub, Drive `changes.watch`). Needs a public HTTPS endpoint, a Google Cloud Pub/Sub topic for Gmail, and channel renewal. Polling every few minutes is enough for documents.

## 6. Proposed order

1. **Sources foundation and IMAP**: `ingestion_sources`, `source_poll`, `document_origins`, REST, the Sources page, shipped with the IMAP connector (any mailbox, Gmail included through an app password, whole messages through the existing `.eml` path).
2. **Google OAuth client and Drive by reference** (`drive.readonly`, one folder, native Google files excluded): nullable `storage_key`, `getDocumentFile` resolving remote files with the checksum guard, the proxied download, the drift and removal policies of 4.3, after the spec is amended.
3. **Gmail API**, on the same OAuth, if it proves more useful than IMAP.
4. **SFTP/FTPS**, with a listing state of its own and the stability rule shared with the watcher.

Each step is one pull request or a few, and each leaves the product working.

## 7. Decisions needed

| #   | Decision                                | Proposal                                                                                                                       |
| --- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Gmail through IMAP or the Gmail API     | **Decided:** IMAP first, Gmail API later if more useful                                                                        |
| 1b  | Sync state                              | **Decided:** a cursor per source, no item history                                                                              |
| 2   | Whole message or attachments only       | **Decided:** whole `.eml`, only messages with an attachment; an option includes the others                                     |
| 3   | Drive scope                             | **Decided:** `drive.readonly`, client "In production" unverified                                                               |
| 4   | Native Google files                     | **Decided:** excluded at first; later exported to PDF and stored                                                               |
| 5   | Reference mode                          | **Decided:** Drive by reference (file id), no copy                                                                             |
| 6   | Drift in reference mode                 | **Decided:** a changed checksum is a new document, the old one is deleted; downloads check the checksum first                  |
| 7   | File removed upstream in reference mode | **Decided:** document and knowledge stay, file marked unavailable (410)                                                        |
| 8   | Spec amendments                         | **Decided:** recorded in the decision table of the spec with this study                                                        |
| 9   | MCP access to sources                   | None at first (credentials stay behind the session cookie)                                                                     |
| 10  | Listing of the items a source took      | **Decided:** none (`GET /sources/:id/items` is dropped): a cursor only (1b); the last run names its skipped items              |
| 11  | Filters of section 2.6                  | **Decided:** `hint` and `private` per source with the first brick; extension or MIME filters with the file kinds (Drive, SFTP) |
