---
'@liasse/sdk': patch
---

Document that on macOS, Node 24 below 24.22.3, Node 25 and Node 26 below 26.5.1 bundle an undici whose `fetch` can throw an uncaught `EINVAL` from `setTypeOfService` when a connection is reset, and recommend a fixed Node. The SDK's `engines` is unchanged.
