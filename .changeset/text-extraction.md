---
'@liasse/core': minor
---

Add `@liasse/core/text`: `extractText` reads the text layer of PDFs, DOCX files and emails, and transcribes scanned PDFs (rendered by `pdftoppm` at 200 dpi) and JPEG, PNG and HEIC images with the vision model. `MAX_VISION_PAGES` caps the pages of a scanned PDF sent to the vision model.
