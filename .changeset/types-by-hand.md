---
'@liasse/contract': minor
'@liasse/core': minor
'@liasse/server': minor
'@liasse/sdk': minor
'@liasse/web': minor
---

`POST /types` creates a type by hand, `provisional` like one the pipeline creates, judged by the naming rules, primitives and two-level hierarchy of the registry under its lock; a refusal answers 400 with the code of the registry. The daily quota of new types does not refuse it. The SDK gains `createType`, and the web UI a Types page that lists the types with their status, fields and document counts, shows each type, and creates one.
