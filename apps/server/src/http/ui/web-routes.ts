import { randomBytes } from 'node:crypto';
import { CSP_NONCE_META_PROPERTY } from '@liasse/core/contract';
import { Hono } from 'hono';
import type { AppEnv } from '../env.ts';
import { failure, respondWith } from '../errors.ts';
import type { WebAssets } from './web-assets.ts';

export const UI_ROOT = '/ui';

/**
 * Scripts and stylesheets of this origin only. The nonce admits the style elements Radix
 * and the scroll lock insert at run time, which read it from the meta tag of the page; no
 * inline script and no `eval` ever run, so a document that slipped markup into the page
 * would still run nothing and send nothing elsewhere.
 */
export const uiContentSecurityPolicy = (nonce: string): string =>
  [
    "default-src 'none'",
    "script-src 'self'",
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "form-action 'self'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join('; ');

const IMMUTABLE = 'public, max-age=31536000, immutable';

const withNonce = (index: string, nonce: string): string =>
  index.replace('<head>', `<head><meta property="${CSP_NONCE_META_PROPERTY}" nonce="${nonce}" />`);

const MISSING_ASSET = failure(404, 'not_found', 'No such file.');

/**
 * The built single-page application under `/ui`: its files as they are, and `index.html`
 * for any other path, which the router of the application reads.
 */
export const webRoutes = (assets: WebAssets): Hono<AppEnv> =>
  new Hono<AppEnv>().get('/*', (context) => {
    const path = context.req.path.slice(UI_ROOT.length).replace(/^\/+/, '');
    const file = assets.files.get(path);
    if (file !== undefined) {
      return context.body(file.body, 200, {
        'Content-Type': file.type,
        'Cache-Control': file.immutable ? IMMUTABLE : 'no-cache',
      });
    }
    // A missing script or stylesheet answered with the page would run as neither.
    if (/\.[a-z0-9]+$/i.test(path)) return respondWith(context, MISSING_ASSET);
    const nonce = randomBytes(16).toString('base64');
    return context.html(withNonce(assets.index, nonce), 200, {
      'Cache-Control': 'no-cache',
      'Content-Security-Policy': uiContentSecurityPolicy(nonce),
    });
  });
