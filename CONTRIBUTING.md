# Contributing to Liasse

Thanks for your interest in Liasse!

## Language

Everything in this repository is written in English: code, identifiers, comments, commit messages, issues, pull requests, documentation and prompts.

## Developer Certificate of Origin

Liasse uses the [Developer Certificate of Origin](https://developercertificate.org/) (DCO) instead of a CLA. Every commit must be signed off:

```sh
git commit -s -m "feat: add something"
```

This adds a `Signed-off-by: Your Name <you@example.com>` trailer certifying that you wrote the change or have the right to submit it under the project's license (AGPL-3.0).

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/); CI checks both the format and the sign-off. The sign-off must carry the email of the commit author. To check a branch before pushing:

```sh
scripts/check-dco.sh main
pnpm exec commitlint --from main
```

## Development

You need Node 22 or later, pnpm, Docker and poppler (`poppler-utils` on Debian and Ubuntu, `poppler` with Homebrew), whose `pdfinfo` and `pdftoppm` measure and render scanned PDFs.

```sh
pnpm install
pnpm db:up            # Postgres with pgvector on 127.0.0.1:54329, S3 test server on 127.0.0.1:54330
cp .env.example .env
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm --filter @liasse/server dev
```

BM25 ranking is optional and has tests of its own, which need Postgres with ParadeDB `pg_search`:

```sh
pnpm db:up:paradedb   # Postgres with pg_search on 127.0.0.1:54331
pnpm test:paradedb
```

Conventions, layout and testing rules are in [`AGENTS.md`](AGENTS.md); they apply to humans too.

## Before you start

- The design lives in [`docs/spec.md`](docs/spec.md). For anything beyond a small fix, open an issue first so we can agree on the approach.
- Never commit real personal documents. Tests and fixtures use synthetic documents only.
- Be kind: the [code of conduct](CODE_OF_CONDUCT.md) applies everywhere in the project. Report a vulnerability privately, as [`SECURITY.md`](SECURITY.md) describes, never in an issue.

## Changesets and releases

A pull request that changes what users see (a feature, a fix, a configuration variable, an answer of the API) adds a changeset: run `pnpm changeset`, pick the packages it changes and the kind of bump, and describe the change for the changelog. Internal changes (tests, CI, refactoring) need none.

The `Release` workflow does the rest on `main`:

1. While changesets are pending, it opens or updates the pull request `chore(release): version packages`, which bumps the versions and writes the `CHANGELOG.md` of each package.
2. Merging that pull request releases the version of `@liasse/server`: a GitHub release `v<version>`, whose notes are the new sections of the changelogs, and the multi-arch image `ghcr.io/wallforfry/liasse` with the tags `<version>`, `<major>.<minor>` and `latest`.

GitHub starts no workflow for a pull request the workflow token opened: close and reopen the version pull request to run CI on it before merging. The repository must allow GitHub Actions to create pull requests (Settings, Actions, General).
