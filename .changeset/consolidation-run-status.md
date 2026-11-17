---
'@liasse/contract': minor
'@liasse/core': minor
'@liasse/server': minor
'@liasse/sdk': minor
'@liasse/web': minor
---

The state of consolidation runs can be followed: `GET /consolidation/runs` (`listConsolidationRuns` in the SDK) lists the latest runs with their status, attempts and the error of a failed attempt. The Changes screen of the web UI shows where the latest run stands, follows it until it ends, says when it finished or failed, and reads the changes again. `CONSOLIDATION_TRIGGERS` and `ConsolidationTrigger` now come from `@liasse/contract/domain`, no longer from `@liasse/core/consolidation`.
