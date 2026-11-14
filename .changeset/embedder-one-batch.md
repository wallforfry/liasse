---
'@liasse/core': patch
---

The process of the local embedding model serves one request at a time, in the order they arrive: two jobs that embed at once no longer run their batches side by side in one ONNX Runtime process, so its memory peak stays the one of a single batch whatever `WORKERS` says. Answers still go back by request id, and the idle stop is unchanged.
