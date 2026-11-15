import { z } from 'zod';

// The session of the web UI, between the server and the single-page application. It is
// not part of the agent API: neither the SDK nor the OpenAPI document describes it.

/** Where a browser session sends its CSRF token, on every method but GET, HEAD and OPTIONS. */
export const CSRF_HEADER = 'X-CSRF-Token';

/** The `<meta property>` the server writes the CSP nonce of a page into, in its `nonce`. */
export const CSP_NONCE_META_PROPERTY = 'csp-nonce';

export const MAX_UI_PASSWORD_LENGTH = 1024;

/** `POST /ui/session`. */
export const uiLoginSchema = z.strictObject({
  password: z.string().min(1).max(MAX_UI_PASSWORD_LENGTH),
});
export type UiLogin = z.output<typeof uiLoginSchema>;

/** What `POST` and `GET /ui/session` answer for a live session. */
export const uiSessionSchema = z.object({
  csrf_token: z.string().min(1),
});
export type UiSession = z.output<typeof uiSessionSchema>;
