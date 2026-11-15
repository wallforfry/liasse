---
'@liasse/core': patch
---

Two entity or subject merges decided at the same time no longer deadlock when applying one rewrites the other: a decision on such a merge now takes the entity lock before the row of its change.
