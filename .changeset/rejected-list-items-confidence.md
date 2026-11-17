---
'@liasse/core': patch
---

A rejected item of a core list such as `key_dates` now weighs at 0 in the mean of its list, which counts as one field, instead of counting as a field at 0 of its own. A document whose model returned many key dates without a verifiable quote was flagged `needs_review` with a confidence far below the one of its type and of its kept values. A core value corrected by hand counts once, at 1, even when the model's new reading of it was rejected. Documents already settled keep their confidence until they are extracted again.
