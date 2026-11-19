---
'@liasse/web': minor
---

The tables of the web UI are one data table (TanStack Table under the shadcn table, `components/data-table`), and the lists of documents, API keys and MCP connections select rows with a checkbox for actions on all of them at once. A checkbox in the header selects every row shown; while a row is selected, a bar above the table counts the selection and holds its actions: deleting documents and retrying the failed ones among them, deleting API keys and revoking MCP connections. A deletion or a revocation asks for a confirmation first. Each row is sent on its own, so one refused row does not stop the others, and the toasts count the rows done and the rows refused with the first reason. The selection covers the rows of the page shown, and empties once an action is done.
