# Deployment

Liasse is one container and one Postgres with pgvector. [`docker-compose.yml`](../docker-compose.yml) runs both; the [README](../README.md#start-in-5-minutes) walks through a first start. This page covers what comes after.

## Compose variables

The compose file reads `.env` next to it, written from [`.env.example`](../.env.example), and these variables of its own:

| Variable            | Default                 | Role                                                                             |
| ------------------- | ----------------------- | -------------------------------------------------------------------------------- |
| `POSTGRES_PASSWORD` | required                | Database password, put in a URL: use letters and digits (`openssl rand -hex 24`) |
| `PUBLIC_URL`        | `http://localhost:8080` | Origin clients reach Liasse at                                                   |
| `LIASSE_LISTEN`     | `127.0.0.1:8080`        | Host address and port the container is published on                              |
| `LIASSE_VERSION`    | `latest`                | Tag of `ghcr.io/wallforfry/liasse`                                               |

The compose file sets `DATABASE_URL`, `HOST`, `PORT`, `STORAGE_PATH` and `EMBEDDING_CACHE_DIR` itself, over the values of `.env`, which suit a server run from source. Files and the local embedding model live in the `liasse-data` volume, the database in `postgres-data`: back up both.

## Settings

The models, their keys, the embedder, the pipeline and Hindsight are settings stored in the database, in one row of the `settings` table; their keys are encrypted there with a key derived from `AUTH_SECRET`. A server without settings serves the web UI and the auth server, answers `503 not_configured` on the routes of the API, and runs no worker and no watched folder. A save applies at once, without a restart: jobs in progress finish with the models they started with.

Changing `AUTH_SECRET` leaves the stored keys unreadable. The server still starts, and says on stderr which section's key does not decrypt, never the key. `GET /settings` reports that key as `unreadable`, and the server runs as if it had no settings until a save replaces or clears it. A save that keeps an unreadable key is refused with 400. Restoring the former `AUTH_SECRET` and restarting also brings everything back.

Every process on the database follows the settings: the HTTP server, MCP over stdio and every other instance. A save notifies the channel `liasse_settings` with its version when it commits. A process that `LISTEN`s on it puts newer settings in force at once, and reads the stored version again each time its listener connects again, so a save made while it was cut off is not missed. A reading that fails is tried again with a growing delay until one succeeds. Behind a transaction pooler, which refuses `LISTEN`, the server says so at startup; another process then takes a save into account when it claims a job queued under it, or when it restarts.

The onboarding of the web UI saves the first settings, and its settings page (in the account menu) changes them. The routes `GET /settings`, `PUT /settings`, `POST /settings/check` and `POST /settings/models` take the session of the web UI only, never an API key, so a leaked key cannot point the models elsewhere. Without a browser, save them with `curl` and a session:

```bash
curl -sS -c cookies.txt -H 'Origin: http://localhost:8080' -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"..."}' http://localhost:8080/api/auth/sign-in/email
curl -sS -b cookies.txt -H 'Origin: http://localhost:8080' -H 'Content-Type: application/json' \
  -X PUT -d @settings.json http://localhost:8080/settings
```

with a `settings.json` such as:

```json
{
  "version": 0,
  "settings": {
    "llm": {
      "provider": "anthropic",
      "api_key": { "action": "replace", "value": "..." },
      "text_model": "...",
      "vision_model": "..."
    }
  }
}
```

`version` is the one `GET /settings` answers, 0 before the first save: a save of a stale version answers 409. Every section but `llm` may be left out, for its defaults: `embedding` (`local` by default; `provider`, `model`, `base_url`, `timeout_ms`, `max_input_tokens`, `api_key`), `pipeline` (`max_file_size`, `auto_apply`, `confidence_threshold`, `max_new_types_per_day`, `schema_language`, `max_vision_pages`, `entity_attach_similarity`, `entity_arbitration_similarity`) and `hindsight` (`url`, `bank`, `api_key`). A key is never answered: `GET /settings` gives the state of each one (`set`, `unset` or `unreadable`), and a save keeps it (`{"action": "keep"}`, the default), replaces it or clears it (`{"action": "clear"}`). `POST /settings/check` takes `{"settings": ...}` and tries each part with one short call, without saving. The embedder can no longer change once a document exists. A save that changes it waits for the uploads in progress, and they wait for it. Every job records the version of the settings it was queued under: a process that claims a job queued under settings newer than its own puts them in force first, and puts the job back without counting an attempt until it can, with a delay that doubles up to 5 minutes. Settings a process cannot put in force are reported once per version on its stderr, and not built again until they are saved again. No process indexes a document with the embedder being replaced, whichever process claims the job.

### Upgrading from environment variables

Earlier versions read these settings from the environment. The server now refuses to start while one of their variables is set, and names it: `LLM_PROVIDER`, `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_TIMEOUT`, `TEXT_MODEL`, `VISION_MODEL`, `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, `EMBEDDING_API_KEY`, `EMBEDDING_BASE_URL`, `EMBEDDING_TIMEOUT`, `EMBEDDING_MAX_INPUT_TOKENS`, `MAX_FILE_SIZE`, `AUTO_APPLY`, `CONFIDENCE_THRESHOLD`, `MAX_NEW_TYPES_PER_DAY`, `SCHEMA_LANGUAGE`, `MAX_VISION_PAGES`, `ENTITY_ATTACH_SIMILARITY`, `ENTITY_ARBITRATION_SIMILARITY`, `HINDSIGHT_URL`, `HINDSIGHT_BANK` and `HINDSIGHT_API_KEY`. Note their values, remove them from `.env`, start the server and save them as above, a duration such as `5m` becoming milliseconds (`timeout_ms: 300000`). Save the embedder the documents were indexed with: the first save of a database that holds documents is the one that can still name it.

The server refuses to start, too, while `AUTH_BOOTSTRAP_EMAIL` or `AUTH_BOOTSTRAP_PASSWORD` is set: the first account is now created by the onboarding, with the setup token the server prints at startup while no account exists. Remove them; an existing account is kept.

## Image

The image (`linux/amd64`, `linux/arm64`) carries the server, the build of the web UI, poppler (`pdfinfo` and `pdftoppm`, for scanned PDFs) and the runtime of the local embedder. It runs as the `node` user, keeps its data under `/data` and has a health check on `GET /health`.

The `Image` workflow publishes it to GHCR:

| Tag                                      | Published for                    |
| ---------------------------------------- | -------------------------------- |
| `edge`, `sha-<commit>`                   | every push to `main`             |
| `<version>`, `<major>.<minor>`, `latest` | every release (`v<version>` tag) |

`latest` is the most recent release; set `LIASSE_VERSION=edge` to follow `main`. `docker compose up -d --build` always builds from the checkout. While the repository is private, so is the package: `docker login ghcr.io` with a token that can read it first.

## Upgrades

```bash
docker compose pull
docker compose up -d
```

The server applies pending migrations at startup, in one transaction: a migration that fails leaves the database as it was, and the server refuses to start with the reason in its log (`docker compose logs liasse`). Pin `LIASSE_VERSION` to a version to upgrade only when you choose to, and read the notes of the [releases](https://github.com/wallforfry/liasse/releases) in between first.

On shutdown the server lets running jobs finish for 30 seconds, so the compose file gives the container 40 seconds before Docker kills it; with `docker run`, pass `--stop-timeout 40`.

## Reverse proxy and TLS

Liasse speaks plain HTTP and listens on `127.0.0.1` by default. Put a TLS reverse proxy in front of it before publishing it further, and set `PUBLIC_URL` to the address clients use: signed file URLs start with it, and the web UI's requests that change something must come from that origin. MCP clients that speak OAuth connect to `PUBLIC_URL/mcp` and sign in through the web UI when `PUBLIC_URL` is https or a loopback address (`localhost`, `127.0.0.1`, `[::1]`); others pass an API key as `Authorization: Bearer <key>`.

The sign-in rate limit (5 attempts per minute) counts each client apart only when `TRUSTED_PROXIES` lists the proxies in front of Liasse. Without it, every client counts as the proxy, so anyone who reaches the login page can keep the owner out for as long as they keep trying; API keys keep working meanwhile. A trusted range must hold only proxies, and the proxy must rewrite `X-Forwarded-For` from peers it does not trust, or a client could pick the address it is counted under. When Cloudflare proxies the domain, add `cloudflare` to `TRUSTED_PROXIES`.

## Ollama on the host

Inside the container, `127.0.0.1` is the container itself: an Ollama server on the host has the base URL `http://host.docker.internal:11434` in the settings. Docker Desktop resolves that name; on Linux, add `extra_hosts: ['host.docker.internal:host-gateway']` to the `liasse` service, and make Ollama listen on an address the container reaches (`OLLAMA_HOST=0.0.0.0`).

## Watched folder

`WATCH_DIR` needs a volume that mounts the host folder at that path, for instance `/srv/scans:/watch:ro` with `WATCH_DIR=/watch`. Liasse only reads the folder; see [Watched folder](spec.md#api-configuration-and-deployment) in the specification for what it ingests and when.

## Ingestion sources

Sources are configured on the **Sources** page of the web UI, never in the environment; see [Ingestion sources](spec.md#ingestion-sources) in the specification. Their passwords are sealed under `AUTH_SECRET`: rotating it makes them unreadable, and each source then needs its password again. The server connects to whatever host a signed-in account names, internal addresses included.

**A Gmail mailbox over IMAP.** Turn on 2-Step Verification on the Google account, create an app password (Google account, Security, App passwords), then create an IMAP source with host `imap.gmail.com`, port `993`, security `tls`, the full address as user name and the app password. A label is read as a folder of the same name (`INBOX`, `Invoices`, `[Gmail]/All Mail`). Liasse opens folders read-only and never marks a message as read.

## Coolify

[`docker-compose.coolify.yml`](../docker-compose.coolify.yml) is the same stack for a Coolify Docker Compose application built from this repository. Coolify generates the database password, `AUTH_SECRET` and `FILE_URL_SECRET`, and routes the domain set on the `liasse` service to port 8080.

1. Create the application from the repository with the Docker Compose build pack and `/docker-compose.coolify.yml` as its Docker Compose location.
2. Deploy it, and read the setup token in the logs of the `liasse` service.
3. Open the domain: the onboarding asks for that token, creates the first account and saves the [settings](#settings).

The compose file trusts `172.16.0.0/12`, Docker's default range for the network Coolify's proxy reaches the container over; when Cloudflare proxies the domain, set `TRUSTED_PROXIES` to `172.16.0.0/12,cloudflare`. No untrusted container may share a network with `liasse`. Behind a Cloudflare Tunnel, every client counts as the `cloudflared` container unless its address is trusted too.

Files stay in the `liasse-data` volume unless `STORAGE_DRIVER` is `s3`: set it in Coolify with `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` and, for a server other than AWS, `S3_ENDPOINT` (and `S3_REGION` if it checks the region). The key of a file is the same in both drivers, its path under `/data/files`, so moving to a bucket is copying that directory to the root of the bucket while the application is stopped, then deploying with the new variables. Any other variable of `.env.example` must also be named under `environment` in the compose file before Coolify passes it to the server.

## Resources

The target is under 150 MB of RAM for the idle container, Postgres excluded. `scripts/check-idle-memory.sh <image>` starts an image with Postgres, waits for its health check and measures it; CI runs it on every pull request that changes more than Markdown. The local embedding model runs in a child process only while it works, between 0.8 and 1.35 GB at its peak, and ends after 10 minutes without a request.
