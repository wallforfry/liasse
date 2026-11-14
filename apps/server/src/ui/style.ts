// Served as a file, not inlined: the policy of the pages allows styles from this origin
// only, and no inline style.
export const STYLESHEET = `
:root { color-scheme: light dark; --muted: #6b7280; --line: #d1d5db; --accent: #2563eb; }
* { box-sizing: border-box; }
body { margin: 0; font: 15px/1.5 system-ui, sans-serif; }
header nav { display: flex; flex-wrap: wrap; gap: 1rem; align-items: center;
  padding: 0.75rem 1rem; border-bottom: 1px solid var(--line); }
header nav a { color: var(--accent); text-decoration: none; }
main { max-width: 72rem; margin: 0 auto; padding: 1rem; }
h1 { font-size: 1.4rem; margin: 0.5rem 0 1rem; }
h2 { font-size: 1.1rem; margin: 1.5rem 0 0.5rem; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 0.35rem 0.5rem; border-bottom: 1px solid var(--line);
  vertical-align: top; overflow-wrap: anywhere; }
form.inline { display: inline; }
form.stack { display: grid; gap: 0.75rem; max-width: 40rem; }
form.filters { display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: end; margin-bottom: 1rem; }
label { display: grid; gap: 0.25rem; }
label.check { display: flex; gap: 0.5rem; align-items: center; }
input, select, textarea, button { font: inherit; }
textarea { min-height: 8rem; font-family: ui-monospace, monospace; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; padding: 0.75rem;
  border: 1px solid var(--line); max-height: 40rem; overflow: auto; }
img.preview { max-width: 100%; border: 1px solid var(--line); }
.muted { color: var(--muted); }
.notice { padding: 0.5rem 0.75rem; border: 1px solid var(--line); }
.notice.error { border-color: #dc2626; }
.pager { display: flex; gap: 1rem; margin-top: 1rem; }
mark { padding: 0 0.1em; }
`;
