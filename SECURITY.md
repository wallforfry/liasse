# Security policy

Liasse holds personal documents (taxes, health, banking), so a vulnerability can expose exactly what its users most want kept private. Thank you for reporting one carefully.

## Reporting a vulnerability

Report it privately through [GitHub's private vulnerability reporting](https://github.com/wallforfry/liasse/security/advisories/new). Do not open a public issue, pull request or discussion for it.

Please include:

- the version or commit you tested, and how Liasse was deployed (image, compose file, configuration without secrets);
- the steps to reproduce, with synthetic documents only;
- what an attacker gains, and what they need first (an account, an API key, network access, a crafted document).

You will get an acknowledgement within 7 days. We will agree on a disclosure date with you, publish a fix and an advisory, and credit you unless you prefer otherwise.

## Supported versions

Only the latest release gets security fixes. A fix lands on `main` and in the `edge` image first, then in the next release.

## Scope

In scope: the server, the web UI, the MCP server, the SDK, the Docker image and the compose files of this repository. Among the cases we especially want to hear about:

- access to a document, a file or an account without valid credentials, or beyond what an API key, a session or an OAuth token allows;
- a document whose content makes Liasse take an action, or makes an agent or the web UI run something (prompt injection, script injection);
- a private document reaching Hindsight, an external embedding provider, or a result that did not ask for private documents;
- a sensitive identifier (IBAN, tax number, social security number) stored or returned unmasked outside the document's full text;
- a secret or a document's content written to a log.

Out of scope: an instance published without TLS or with a misconfigured `TRUSTED_PROXIES` (see [`docs/deployment.md`](docs/deployment.md)), the server connecting to a host a signed-in account named for an ingestion source (internal addresses included: it is what a source is for), what a model provider does with the data it is sent, and denial of service by an authenticated user.

The security model is described in [`docs/spec.md`](docs/spec.md#safeguards-security-and-privacy).
