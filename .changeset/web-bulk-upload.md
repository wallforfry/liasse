---
'@liasse/web': minor
---

The upload page takes several files at once. They are sent one after the other with the same hint and privacy, and a list shows the state of each: waiting, uploading, uploaded or already in Liasse (with a link to the document), or the reason the server refused it. A refused file does not stop the others; a lost session stops the batch and opens the login page. A single file still opens its document once uploaded.
