---
'@liasse/core': minor
'@liasse/server': minor
---

`ENTITY_ATTACH_SIMILARITY` and `ENTITY_ARBITRATION_SIMILARITY` set the thresholds of entity resolution by similarity (decimals from 0 to 1, arbitration not above attach); subjects use the same ones. The defaults become 1 and 0.80, measured with the default local embedder by `pnpm eval:calibrate`: similarity alone no longer attaches a mention, the text model decides every candidate from 0.80. Another embedder needs its own measure with `pnpm eval:calibrate`.
