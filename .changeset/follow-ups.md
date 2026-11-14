---
'@liasse/core': patch
'@liasse/server': patch
---

Follow-ups of the foundation reviews:

- `migrate` refuses a journal that lists the same migration (same content, same date) twice.
- A model provider that cannot be reached fails with the network code (`ECONNREFUSED`, `ENOTFOUND`) instead of no code, and a provider error reports both its type and its code. `LLM_BASE_URL` and `EMBEDDING_BASE_URL` are refused when they carry a `?` or a `#`. The startup lookup of a self-hosted endpoint gives up after three seconds, and the privacy warning says when the name did not resolve.
- The currency list gains `XAD` and loses `CNX`. Type slugs may carry the short forms of months again (`data_set`, `seguro_mar`), and are refused the name of an organisation of two letters (`bp_invoice`).
