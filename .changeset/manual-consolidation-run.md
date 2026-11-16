---
'@liasse/contract': minor
'@liasse/core': minor
'@liasse/server': minor
'@liasse/sdk': minor
'@liasse/web': minor
---

A consolidation run can be asked for by hand: `POST /consolidation/runs` (`requestConsolidationRun` in the SDK) queues one at once, unless a run due at once already waits, and the Changes screen of the web UI has a "Run consolidation" button.
