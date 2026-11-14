---
'@liasse/core': minor
'@liasse/server': minor
---

Hybrid search ranks its full-text side with BM25 when ParadeDB `pg_search` 0.26 or later is created in the database. At startup, `prepareFullTextRanking` (`@liasse/core/search`) reads the installed version from the catalog, creates the BM25 index `chunks_bm25_idx` when it is missing or stale, and returns `rankByBm25`; without the extension it returns `rankByFullText` (`ts_rank_cd`) and nothing changes, and with an older one a startup notice says why BM25 is not used. BM25 only orders the chunks: which ones match is still decided by the language-aware `tsvector` query. The index reads `liasse_bm25_document(language, text)`, the lexemes of `liasse_tsvector`, added by a migration.

`ApiContext` takes `fullText`, the ranker `searchDocuments` passes to `search`. `rankByFullText` is exported by `@liasse/core/search`. The index carries a signature of its definition and of the functions and text search configurations its lexemes come from, and a startup that finds another one builds it again. BM25 queries turn the planner warnings of pg_search off in their own transaction; no connection carries a pg_search setting. `pnpm db:up:paradedb` starts a Postgres with `pg_search` on `127.0.0.1:54331` and `pnpm test:paradedb` runs the BM25 tests against it.
