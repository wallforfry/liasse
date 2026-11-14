import { html } from 'hono/html';
import { z } from 'zod';
import { csrfField, type Markup, notice, UI_ROOT } from '../markup.ts';

// The consolidation feature defines what it lists; this page needs an id per change and
// shows the rest as it comes. Rationales and payloads quote type and field names drawn
// from documents: they are escaped like any document content.
const changeListSchema = z.looseObject({
  changes: z.array(
    z.looseObject({
      id: z.string(),
      kind: z.string().optional(),
      rationale: z.string().nullable().optional(),
    }),
  ),
});

const changePath = (id: string): string => `${UI_ROOT}/changes/${encodeURIComponent(id)}`;

const decisionForm = (id: string, csrfToken: string): Markup =>
  html`<form method="post" action="${changePath(id)}" class="stack">
    ${csrfField(csrfToken)}
    <label>Note <input name="note" maxlength="2000" /></label>
    <p>
      <button type="submit" name="decision" value="apply">Apply</button>
      <button type="submit" name="decision" value="reject">Reject</button>
    </p>
  </form>`;

export const changesPage = (
  listed: unknown,
  csrfToken: string,
  notices: readonly Markup[] = [],
): Markup => {
  const parsed = changeListSchema.safeParse(listed);
  if (!parsed.success) {
    return html`${notices}${notice('The pending changes could not be read.', 'error')}`;
  }
  const { changes } = parsed.data;
  return html`${notices}
  ${
    changes.length === 0
      ? html`<p>No change waits for approval.</p>`
      : changes.map(
          ({ id, kind, rationale, ...rest }) =>
            html`<section>
              <h2>${kind ?? 'change'} <span class="muted">${id}</span></h2>
              ${rationale === undefined || rationale === null ? '' : html`<p>${rationale}</p>`}
              <pre>${JSON.stringify(rest, null, 2)}</pre>
              ${decisionForm(id, csrfToken)}
            </section>`,
        )
  }`;
};
