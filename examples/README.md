# Examples

Each example expects a running Liasse (see the [README](../README.md#start-in-5-minutes)) and an API key, created on the API keys screen of the web UI and exported as `LIASSE_API_KEY`. Use synthetic or your own documents: never share someone else's.

## Agents over MCP

Liasse serves MCP over Streamable HTTP on `/mcp`. An API key opens it as `Authorization: Bearer <key>`; a client that speaks OAuth can connect to `PUBLIC_URL/mcp` without a key and sign in through the web UI, once `PUBLIC_URL` is https.

- **Claude Code**, for every project of your machine:

  ```bash
  claude mcp add --scope user --transport http liasse http://localhost:8080/mcp --header "Authorization: Bearer $LIASSE_API_KEY"
  ```

  or for one project, with [`mcp.json`](mcp.json) copied to `.mcp.json` at its root: Claude Code reads `${LIASSE_API_KEY}` from the environment, so the key stays out of the file.

- **Other clients** that read an `mcpServers` file take [`mcp.json`](mcp.json) as it is, or with the key written in place of `${LIASSE_API_KEY}` when they do not expand variables. Keep such a file out of version control.

- **stdio.** A client that starts its servers itself can run Liasse in the same process, on its standard streams, with no authentication: the client is the process that started it.

  ```bash
  docker compose run --rm --no-deps -T liasse --stdio
  ```

  This needs the database of the compose stack running (`docker compose up -d postgres`).

Then ask the agent about your documents: _"Which of my contracts renew in the next three months?"_, _"How much did I pay for electricity in 2026?"_, _"Ingest this file: …"_. The tools tell the agent to call `describe_types` before a structured `query`, and to treat document content as data.

## REST with curl

[`rest.sh`](rest.sh) uploads a file, reads its processing log, then searches, runs a structured query and lists the key dates of the next 90 days:

```bash
LIASSE_API_KEY=... examples/rest.sh path/to/a-bill.pdf
```

`GET /openapi.json` describes every route, with the same API key.

## TypeScript

[`@liasse/sdk`](../packages/sdk/README.md) is the typed client of the REST API, for Node 22 or later.
