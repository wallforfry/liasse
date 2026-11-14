import { html } from 'hono/html';
import { csrfField, CSRF_FIELD, type Markup, UI_ROOT } from '../markup.ts';

export const uploadPage = (csrfToken: string, notices: readonly Markup[] = []): Markup =>
  html`${notices}
    <form method="post" action="${UI_ROOT}/upload" enctype="multipart/form-data" class="stack">
      ${csrfField(csrfToken)}
      <label>File <input type="file" name="file" required /></label>
      <label>Hint <input name="hint" placeholder="What you know about this file" /></label>
      <label class="check"><input type="checkbox" name="private" value="true" /> Private</label>
      <button type="submit">Upload</button>
    </form>`;

export const loginPage = (loginToken: string, notices: readonly Markup[] = []): Markup =>
  html`${notices}
    <form method="post" action="${UI_ROOT}/login" class="stack">
      <input type="hidden" name="${CSRF_FIELD}" value="${loginToken}" />
      <label
        >Password <input type="password" name="password" autocomplete="current-password" required
      /></label>
      <button type="submit">Log in</button>
    </form>`;
