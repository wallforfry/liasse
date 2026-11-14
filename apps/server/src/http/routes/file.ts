import { Readable } from 'node:stream';
import { openDocumentFile } from '@liasse/core/api';
import { supportedMimeSchema } from '@liasse/core/domain';
import { Hono, type MiddlewareHandler } from 'hono';
import { z } from 'zod';
import { BEARER_SCHEME, failures, operation, SIGNED_URL_SCHEME, valid } from '../describe.ts';
import type { AppEnv } from '../env.ts';
import { idParam } from '../query-params.ts';
import type { RouteDeps } from './deps.ts';

// Types a browser displays without running anything of the file. Everything else is
// downloaded: an email or a DOCX may carry markup, and HEIC is not displayed anyway.
const INLINE_TYPES: readonly string[] = ['application/pdf', 'image/jpeg', 'image/png'];
const FALLBACK_TYPE = 'application/octet-stream';

// The name was given by whoever uploaded the file. The quoted form keeps letters,
// digits and a few marks, so nothing in it can end the parameter or the header; the
// real name travels percent-encoded beside it (RFC 6266, RFC 5987).
const asciiName = (filename: string): string => filename.replace(/[^A-Za-z0-9._-]/g, '_') || 'file';

const encodedName = (filename: string): string =>
  encodeURIComponent(filename).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );

export const contentDisposition = (mime: string, filename: string): string =>
  `${INLINE_TYPES.includes(mime) ? 'inline' : 'attachment'}; ` +
  `filename="${asciiName(filename)}"; filename*=UTF-8''${encodedName(filename)}`;

// The stored type is one ingestion detected from the bytes; anything else a row may
// hold is served as bytes to download.
const servedType = (mime: string): string =>
  supportedMimeSchema.safeParse(mime).success ? mime : FALLBACK_TYPE;

const grantQuery = z.strictObject({
  expires: z.string().optional(),
  signature: z.string().optional(),
});

export interface FileRouteDeps extends Pick<RouteDeps, 'api'> {
  /** A Bearer token, or the grant of a signed URL. No request deadline: a file may be long. */
  readonly fileAccess: MiddlewareHandler<AppEnv>;
}

export const fileRoutes = ({ api, fileAccess }: FileRouteDeps): Hono<AppEnv> =>
  new Hono<AppEnv>().get(
    '/documents/:id/file',
    operation({
      summary: 'Download the original file',
      tag: 'Documents',
      credentials: [BEARER_SCHEME, SIGNED_URL_SCHEME],
      responses: {
        200: {
          description: 'The file, as it was uploaded.',
          content: { '*/*': { schema: { type: 'string', format: 'binary' } } },
        },
        ...failures(400, 404),
      },
    }),
    fileAccess,
    valid('param', idParam),
    valid('query', grantQuery),
    async (context) => {
      const { mime, filename, stream } = await openDocumentFile(api, context.req.valid('param').id);
      const type = servedType(mime);
      return new Response(Readable.toWeb(stream), {
        headers: {
          'Content-Type': type,
          'Content-Disposition': contentDisposition(type, filename),
          // No script, no form, no navigation, whatever the file turns out to hold.
          'Content-Security-Policy': 'sandbox',
          'Cache-Control': 'private, no-store',
        },
      });
    },
  );
