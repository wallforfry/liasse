---
'@liasse/core': minor
---

Add local embeddings and hybrid search: a multilingual ONNX embedder that runs in a child process ended when idle (`@liasse/core/embeddings`, model files in `EMBEDDING_CACHE_DIR`), chunking sized to the embedder's input window, `indexDocument` and `search` (`@liasse/core/search`), with language-aware full text. Requires pgvector 0.8 or later, checked at startup.
