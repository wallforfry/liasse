---
'@liasse/web': minor
---

The web UI creates the first account. While the server has none, every route, the login page included, shows the onboarding instead: the setup token the server printed to its logs, the account (name, email, password typed twice, with the length rules of the server), the language models and the embedder, each with a check through `POST /api/setup/check`, then a summary. Finishing calls `POST /api/setup`, signs in and opens the documents. A wrong token returns to its step, a setup finished elsewhere leads to the login page, and a field the server refuses opens its step with the message. The token, the keys and the password stay in the memory of the page.
