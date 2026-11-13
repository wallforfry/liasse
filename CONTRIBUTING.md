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

You need Node 22 or later, pnpm and Docker.

```sh
pnpm install
pnpm db:up            # Postgres with pgvector on 127.0.0.1:54329
cp .env.example .env
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm --filter @liasse/server dev
```

Conventions, layout and testing rules are in [`AGENTS.md`](AGENTS.md); they apply to humans too.

## Before you start

- The design lives in [`docs/spec.md`](docs/spec.md). For anything beyond a small fix, open an issue first so we can agree on the approach.
- Never commit real personal documents. Tests and fixtures use synthetic documents only.
