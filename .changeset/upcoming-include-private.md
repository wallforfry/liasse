---
'@liasse/contract': patch
'@liasse/server': patch
'@liasse/mcp': patch
'@liasse/sdk': patch
---

`upcoming` takes `include_private`, as its MCP description already said: the key dates of private documents are left out unless it is true, on MCP and on `GET /upcoming` alike. An agent that passed it before got a validation error.
