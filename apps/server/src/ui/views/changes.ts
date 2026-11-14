import { type ChangeView, changeListSchema } from '@liasse/core/contract';
import { html } from 'hono/html';
import { csrfField, type Markup, notice, UI_ROOT } from '../markup.ts';

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

// Rationales and payloads quote type and field names drawn from documents by a model:
// they are escaped like any document content.
const changeSection = (
  { id, kind, rationale, payload, auto, created_at: createdAt }: ChangeView,
  csrfToken: string,
): Markup =>
  html`<section>
    <h2>${kind} <span class="muted">${id}</span></h2>
    <p class="muted">
      Proposed ${createdAt}.
      ${auto ? 'Safe by the auto-apply policy.' : 'Needs an approval by the auto-apply policy.'}
    </p>
    <p>${rationale}</p>
    <pre>${JSON.stringify(payload, null, 2)}</pre>
    ${decisionForm(id, csrfToken)}
  </section>`;

export const changesPage = (
  listed: unknown,
  csrfToken: string,
  notices: readonly Markup[] = [],
): Markup => {
  const parsed = changeListSchema.safeParse(listed);
  if (!parsed.success) {
    return html`${notices}${notice('The pending changes could not be read.', 'error')}`;
  }
  const { changes, truncated } = parsed.data;
  return html`${notices}
  ${
    changes.length === 0
      ? html`<p>No change waits for approval.</p>`
      : changes.map((change) => changeSection(change, csrfToken))
  }
  ${truncated ? html`<p class="muted">More changes wait: decide these to see them.</p>` : ''}`;
};
