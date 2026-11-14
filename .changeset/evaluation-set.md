---
'@liasse/core': patch
'@liasse/eval': minor
---

Add the public evaluation set (`@liasse/eval`): 50 synthetic documents of one fictitious household with their ground truth, 20 reference questions, a deterministic generator and pure scoring functions. The synthetic builders of `@liasse/core/testing` gain what it needs: `buildSyntheticPdf` writes text in WinAnsiEncoding (the euro sign reads back) and image-only pages from a JPEG, and `buildSyntheticDocx` can store its parts uncompressed.
