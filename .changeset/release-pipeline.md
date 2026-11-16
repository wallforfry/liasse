---
'@liasse/server': patch
---

Releases are cut by Changesets: merging the version pull request tags `v<version>`, publishes a GitHub release with the changelog and the image tags `<version>`, `<major>.<minor>` and `latest`. The README starts in 5 minutes, `docs/deployment.md` covers the rest of a deployment, and `examples/` holds MCP client configurations and REST calls.
