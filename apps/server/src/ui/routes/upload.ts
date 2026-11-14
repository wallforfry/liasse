import { type ApiContext, ApiError, uploadDocument } from '@liasse/core/api';
import { Hono, type MiddlewareHandler } from 'hono';
import { failureOf } from '../../http/errors.ts';
import { MULTIPART_OVERHEAD_BYTES } from '../../http/routes/upload.ts';
import { formLimit, requireCsrf, type UiEnv } from '../guards.ts';
import { documentPath, notice, page } from '../markup.ts';
import { uploadPage } from '../views/forms.ts';

export interface UploadPageDeps {
  readonly api: ApiContext;
  readonly signedIn: MiddlewareHandler<UiEnv>;
}

export const uploadPages = ({ api, signedIn }: UploadPageDeps): Hono<UiEnv> =>
  new Hono<UiEnv>()
    .get('/upload', signedIn, (context) =>
      context.html(
        page(
          'Upload',
          context.get('session').csrfToken,
          uploadPage(context.get('session').csrfToken),
        ),
      ),
    )
    .post(
      '/upload',
      signedIn,
      // The form is read whole to find its token: this is what bounds that read.
      formLimit(api.maxFileSize + MULTIPART_OVERHEAD_BYTES),
      requireCsrf,
      async (context) => {
        const { file, hint, private: isPrivate } = await context.req.parseBody();
        const { csrfToken } = context.get('session');
        if (!(file instanceof File)) {
          return context.html(
            page('Upload', csrfToken, uploadPage(csrfToken, [notice('Choose a file.', 'error')])),
            400,
          );
        }
        try {
          const { id } = await uploadDocument(api, {
            bytes: new Uint8Array(await file.arrayBuffer()),
            filename: file.name,
            source: 'api',
            hint: typeof hint === 'string' && hint.trim() !== '' ? hint : undefined,
            private: isPrivate === 'true',
          });
          return context.redirect(documentPath(id), 303);
        } catch (error) {
          const refused = error instanceof ApiError ? failureOf(error) : undefined;
          if (refused === undefined) throw error;
          return context.html(
            page('Upload', csrfToken, uploadPage(csrfToken, [notice(refused.message, 'error')])),
            refused.status,
          );
        }
      },
    );
