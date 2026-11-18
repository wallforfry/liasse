import { LiasseResponseError } from '@liasse/sdk';

/** Leaves the application for `url`, as the OAuth flow requires. */
export type NavigateAway = (url: string) => void;

export const leavePage: NavigateAway = (url) => {
  window.location.assign(url);
};

// An OAuth client may redirect to its own scheme (`cursor://...`): only the schemes that run
// script in this page are refused.
const SCRIPT_SCHEMES: ReadonlySet<string> = new Set(['javascript:', 'data:', 'vbscript:']);

/** `url` resolved against the page, or a rejection when it would run script here. */
export const checkedRedirect = (url: string): string => {
  const resolved = URL.parse(url, window.location.href);
  if (resolved === null || SCRIPT_SCHEMES.has(resolved.protocol)) {
    throw new LiasseResponseError(200, 'The server sent a redirection this page refuses.');
  }
  return resolved.href;
};
