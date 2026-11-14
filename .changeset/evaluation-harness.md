---
'@liasse/eval': minor
'@liasse/server': patch
---

Add the regression harness of the evaluation set: `pnpm eval:run` ingests the corpus into a throwaway instance with the configured models, has an agent answer the 20 questions through the MCP tools, scores both and writes a report; `pnpm eval:compare` puts reports side by side; `pnpm eval:calibrate` measures the entity similarity thresholds with the configured embedder. `@liasse/server` exports `createRuntime` as `@liasse/server/runtime`. Scoring: a negation no longer reaches past the end of a sentence and reaches three words, a failure reason names five unwanted documents at most, and the bank statement may link `pays` to the car-park ticket.
