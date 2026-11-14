import { type ApiContext, ApiError, uploadDocument } from '@liasse/core/api';
import { UPLOAD_FILE_FIELD } from '@liasse/core/contract';
import { Hono, type MiddlewareHandler } from 'hono';
import { failureOf } from '../../http/errors.ts';
import { MULTIPART_OVERHEAD_BYTES, textUploadOptionsSchema } from '../../http/routes/upload.ts';
import { filledFields } from '../form-fields.ts';
import { formLimit, requireCsrf, type UiEnv } from '../guards.ts';
import { CSRF_FIELD, documentPath, notice, page } from '../markup.ts';
import { uploadPage } from '../views/forms.ts';

export interface UploadPageDeps {
  readonly api: ApiContext;
  readonly signedIn: MiddlewareHandler<UiEnv>;
  /** A session, under the upload deadline of the API. */
  readonly uploadAccess: MiddlewareHandler<UiEnv>;
}

export const uploadPages = ({ api, signedIn, uploadAccess }: UploadPageDeps): Hono<UiEnv> =>
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
      uploadAccess,
      // The form is read whole to find its token: this is what bounds that read.
      formLimit(api.maxFileSize + MULTIPART_OVERHEAD_BYTES),
      requireCsrf,
      async (context) => {
        const {
          [UPLOAD_FILE_FIELD]: file,
          [CSRF_FIELD]: _token,
          ...fields
        } = await context.req.parseBody();
        const options = textUploadOptionsSchema.parse(filledFields(fields));
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
            ...options,
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
