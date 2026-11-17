---
'@liasse/core': patch
---

The check of the settings shows the vision model a blank JPEG page of 32 by 32 pixels made by a real encoder. The PNG pixel it sent was malformed: its pixel data was short and its chunks misaligned. OpenAI answered that call with HTTP 400 `invalid_value`, most likely because of that image, and the vision model of an otherwise working configuration was reported as failed.
