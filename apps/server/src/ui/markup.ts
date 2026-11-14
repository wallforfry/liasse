import { html } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';

/**
 * Markup built with `html`, which escapes every interpolated value that is not itself
 * markup. Document content (titles, text, fields, file names) is only ever interpolated,
 * never passed to `raw`.
 */
export type Markup = HtmlEscapedString | Promise<HtmlEscapedString>;

export const UI_ROOT = '/ui';
export const STYLESHEET_PATH = `${UI_ROOT}/style.css`;
export const CSRF_FIELD = 'csrf';

// No script at all, and nothing loaded from elsewhere: a document that slipped markup
// past the escaping would still run nothing and send nothing.
export const UI_CONTENT_SECURITY_POLICY =
  "default-src 'none'; style-src 'self'; img-src 'self'; form-action 'self'; " +
  "base-uri 'none'; frame-ancestors 'none'";

export const documentPath = (id: string): string =>
  `${UI_ROOT}/documents/${encodeURIComponent(id)}`;

export const csrfField = (token: string): Markup =>
  html`<input type="hidden" name="${CSRF_FIELD}" value="${token}" />`;

export const formatTime = (iso: string): string => `${iso.slice(0, 16).replace('T', ' ')} UTC`;

const NAVIGATION = [
  ['Documents', `${UI_ROOT}/documents`],
  ['Review', `${UI_ROOT}/review`],
  ['Search', `${UI_ROOT}/search`],
  ['Upload', `${UI_ROOT}/upload`],
  ['Changes', `${UI_ROOT}/changes`],
] as const;

const shell = (title: string, header: Markup, body: Markup): Markup =>
  html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="referrer" content="no-referrer" />
        <title>${title} - Liasse</title>
        <link rel="stylesheet" href="${STYLESHEET_PATH}" />
      </head>
      <body>
        <header>${header}</header>
        <main>${body}</main>
      </body>
    </html>`;

/** A page of a logged-in session: navigation, and the logout form. */
export const page = (title: string, csrfToken: string, body: Markup): Markup =>
  shell(
    title,
    html`<nav>
      <strong>Liasse</strong>
      ${NAVIGATION.map(([label, href]) => html`<a href="${href}">${label}</a>`)}
      <form method="post" action="${UI_ROOT}/logout" class="inline">
        ${csrfField(csrfToken)}<button type="submit">Log out</button>
      </form>
    </nav>`,
    html`<h1>${title}</h1>
      ${body}`,
  );

/** A page shown before logging in. */
export const publicPage = (title: string, body: Markup): Markup =>
  shell(
    title,
    html`<nav><strong>Liasse</strong></nav>`,
    html`<h1>${title}</h1>
      ${body}`,
  );

export const notice = (message: string, kind: 'error' | 'info' = 'info'): Markup =>
  html`<p class="notice ${kind}" role="${kind === 'error' ? 'alert' : 'status'}">${message}</p>`;
