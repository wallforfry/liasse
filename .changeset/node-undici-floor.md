---
'@liasse/contract': patch
'@liasse/core': patch
'@liasse/mcp': patch
'@liasse/sdk': patch
'@liasse/server': patch
---

Require Node 22.12 or later on the 22 line, 24.22.3 or later on the 24 line, or 26.5.1 or later. Earlier Node 24, 25 and 26 releases bundle an undici whose `fetch` can throw an uncaught `EINVAL` from `setTypeOfService` on macOS when a new connection is reset, which ends the process (nodejs/undici#5547). The server now refuses to start on such a Node, with a message that names the supported versions.
