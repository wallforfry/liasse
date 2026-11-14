import { Readable } from 'node:stream';
import { ApiError, type ApiContext, uploadDocument } from '@liasse/core/api';
import {
  UPLOAD_FILE_FIELD,
  type UploadOptions,
  uploadOptionsSchema,
  uploadResultSchema,
} from '@liasse/core/contract';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { resolver } from 'hono-openapi';
import { z } from 'zod';
import { failures, jsonResponse, operation } from '../describe.ts';
import type { AppContext, AppEnv } from '../env.ts';
import { failure, HttpFailure } from '../errors.ts';
import { requireMediaType } from '../guards.ts';
import { flagParam } from '../query-params.ts';
import type { RouteDeps } from './deps.ts';

const MULTIPART = 'multipart/form-data';
const RAW = 'application/octet-stream';
export const FILENAME_HEADER = 'X-Filename';

// What the boundaries, part headers and the other fields of a form may add to the file.
export const MULTIPART_OVERHEAD_BYTES = 1024 * 1024;

// A form field and a query parameter carry text: these read it into the options.
const textOptions = {
  hint: uploadOptionsSchema.shape.hint,
  private: flagParam.optional(),
} satisfies Record<keyof UploadOptions, z.ZodType>;

const formSchema = z.object({
  [UPLOAD_FILE_FIELD]: z.file().describe('The document. Exactly one.'),
  ...textOptions,
});

const optionsSchema = z.strictObject(textOptions).pipe(uploadOptionsSchema);

const FLAG_PROBLEM = '"private" is "true" or "false".';

// Says what is wrong with the options, never what was sent.
const optionsProblem = (error: z.ZodError, otherwise: string): string =>
  error.issues.some(({ code, path }) => code !== 'unrecognized_keys' && path[0] === 'private')
    ? FLAG_PROBLEM
    : otherwise;

const NO_BODY: AsyncIterable<Uint8Array> = Readable.from([]);

const invalid = (message: string): HttpFailure =>
  new HttpFailure(failure(400, 'invalid_request', message));

const tooLarge = (maxFileSize: number): ApiError =>
  new ApiError('too_large', 'file_too_large', 'The file is larger than the limit.', {
    max_file_size: maxFileSize,
  });

// Hono reads a form whole; the body limit of the route is what bounds that read.
const readForm = async (context: AppContext) => {
  const { [UPLOAD_FILE_FIELD]: file, ...others } = await context.req
    .parseBody({ all: true })
    .catch(() => {
      throw invalid('The multipart body could not be read.');
    });
  if (!(file instanceof File)) throw invalid('Expected exactly one file, in the field "file".');
  const fields = optionsSchema.safeParse(others);
  if (!fields.success) {
    throw invalid(
      optionsProblem(fields.error, 'Besides "file", a form holds "hint" and "private" only.'),
    );
  }
  return {
    bytes: new Uint8Array(await file.arrayBuffer()),
    filename: file.name,
    ...fields.data,
  };
};

const decodedName = (header: string | undefined): string => {
  try {
    return decodeURIComponent(header ?? '');
  } catch {
    throw invalid(`${FILENAME_HEADER} must be percent-encoded UTF-8.`);
  }
};

// The body goes to ingestion as it arrives; ingestion stops reading at the size limit.
const readRaw = (context: AppContext, { maxFileSize }: Pick<ApiContext, 'maxFileSize'>) => {
  const declared = Number(context.req.header('Content-Length') ?? 0);
  if (declared > maxFileSize) throw tooLarge(maxFileSize);
  const fields = optionsSchema.safeParse(context.req.query());
  if (!fields.success) {
    throw invalid(optionsProblem(fields.error, 'The query holds "hint" and "private" only.'));
  }
  return {
    stream: context.req.raw.body ?? NO_BODY,
    filename: decodedName(context.req.header(FILENAME_HEADER)),
    ...fields.data,
  };
};

const REQUEST_BODY = {
  required: true,
  content: {
    [MULTIPART]: { schema: resolver(formSchema) },
    [RAW]: { schema: { type: 'string', format: 'binary' } },
  },
} as const;

export const uploadRoutes = ({ api, authenticated }: RouteDeps): Hono<AppEnv> =>
  new Hono<AppEnv>().post(
    '/documents',
    operation({
      summary: 'Upload a document',
      tag: 'Documents',
      requestBody: REQUEST_BODY,
      responses: {
        201: jsonResponse('A new document, queued for processing.', uploadResultSchema),
        200: jsonResponse('These bytes already had this document.', uploadResultSchema),
        ...failures(400, 413, 415),
      },
    }),
    authenticated,
    requireMediaType([MULTIPART, RAW]),
    // A form is read whole before its file is known: this is what bounds that read.
    bodyLimit({
      maxSize: api.maxFileSize + MULTIPART_OVERHEAD_BYTES,
      onError: () => {
        throw tooLarge(api.maxFileSize);
      },
    }),
    async (context) => {
      const isForm = context.req.header('Content-Type')?.toLowerCase().startsWith(MULTIPART);
      const input = isForm === true ? await readForm(context) : readRaw(context, api);
      const result = await uploadDocument(api, { ...input, source: 'api' });
      context.header('Location', `/documents/${result.id}`);
      return context.json(result, result.duplicate ? 200 : 201);
    },
  );
