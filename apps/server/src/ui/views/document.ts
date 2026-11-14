import type { DocumentView } from '@liasse/core/contract';
import { html } from 'hono/html';
import { csrfField, documentPath, formatTime, type Markup, notice } from '../markup.ts';

// What a browser shows in an image element; any other file is only offered as a link.
const IMAGE_TYPES: readonly string[] = ['image/jpeg', 'image/png'];

export interface DocumentPageView {
  readonly document: DocumentView;
  readonly csrfToken: string;
  /** What to say above the document: the outcome of a correction. */
  readonly notices?: readonly Markup[];
}

const shown = (value: unknown): string =>
  typeof value === 'string' ? value : JSON.stringify(value);

const valueTable = (values: Readonly<Record<string, unknown>>): Markup => {
  const entries = Object.entries(values);
  return entries.length === 0
    ? html`<p class="muted">None.</p>`
    : html`<table>
        <tbody>
          ${entries.map(
            ([name, value]) =>
              html`<tr>
                <th>${name}</th>
                <td>${shown(value)}</td>
              </tr>`,
          )}
        </tbody>
      </table>`;
};

const details = (document: DocumentView): Markup =>
  html`<table>
    <tbody>
      <tr>
        <th>Type</th>
        <td>${document.type ?? 'untyped'}</td>
      </tr>
      <tr>
        <th>Status</th>
        <td>${document.status}</td>
      </tr>
      <tr>
        <th>Confidence</th>
        <td>${document.confidence ?? ''}</td>
      </tr>
      <tr>
        <th>Private</th>
        <td>${document.private ? 'yes' : 'no'}</td>
      </tr>
      <tr>
        <th>File</th>
        <td>${document.original_name} (${document.mime})</td>
      </tr>
      <tr>
        <th>Ingested</th>
        <td>${formatTime(document.ingested_at)}</td>
      </tr>
      ${
        document.error === null
          ? ''
          : html`<tr>
              <th>Error</th>
              <td>${document.error}</td>
            </tr>`
      }
    </tbody>
  </table>`;

const preview = (document: DocumentView): Markup => {
  const file = `${documentPath(document.id)}/file`;
  return html`<p>
      <a href="${file}" target="_blank" rel="noopener noreferrer">Open the original file</a>
    </p>
    ${
      IMAGE_TYPES.includes(document.mime)
        ? html`<img class="preview" src="${file}" alt="The original image" />`
        : ''
    }`;
};

const pretty = (values: Readonly<Record<string, unknown>> | undefined): string =>
  JSON.stringify(values ?? {}, null, 2);

const correctionForm = ({ document, csrfToken }: DocumentPageView): Markup =>
  html`<form method="post" action="${documentPath(document.id)}" class="stack">
    ${csrfField(csrfToken)}
    <p class="muted">
      Only what differs from the values shown is sent, and it is kept over what extraction finds.
    </p>
    <label>Type <input name="type" value="${document.type ?? ''}" /></label>
    <label class="check"
      ><input
        type="checkbox"
        name="private"
        value="true"
        ${document.private ? html`checked` : ''}
      />
      Private</label
    >
    <label>Core values (JSON) <textarea name="core">${pretty(document.core)}</textarea></label>
    <label>Fields (JSON) <textarea name="fields">${pretty(document.fields)}</textarea></label>
    <button type="submit">Save the correction</button>
  </form>`;

export const documentPage = (view: DocumentPageView): Markup => {
  const { document } = view;
  return html`${view.notices ?? []}
    ${document.summary === null ? '' : html`<p>${document.summary}</p>`} ${details(document)}
    ${preview(document)}
    <h2>Core values</h2>
    ${valueTable(document.core)}
    <h2>Fields</h2>
    ${valueTable(document.fields ?? {})}
    <h2>Text</h2>
    ${
      document.text === undefined || document.text.content === ''
        ? html`<p class="muted">No text.</p>`
        : html`<pre>${document.text.content}</pre>
            ${
              document.text.has_more
                ? notice(
                    `Only the first characters of ${String(document.text.total_length)} are shown.`,
                  )
                : ''
            }`
    }
    <h2>Correct</h2>
    ${correctionForm(view)}`;
};
