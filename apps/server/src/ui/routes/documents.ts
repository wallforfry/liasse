import {
  type ApiContext,
  ApiError,
  correctDocument,
  getDocument,
  listDocuments,
  PRIVATE_FILTERS,
} from '@liasse/core/api';
import { liveDocumentStatusSchema } from '@liasse/core/domain';
import { type Context, Hono, type MiddlewareHandler } from 'hono';
import { html } from 'hono/html';
import { z } from 'zod';
import { idParam, integerParam } from '../../http/query-params.ts';
import { documentFileResponse } from '../../http/routes/file.ts';
import { readCorrection } from '../correction.ts';
import type { UiEnv } from '../guards.ts';
import { documentPath, type Markup, notice, page, UI_ROOT } from '../markup.ts';
import { documentListView } from '../views/document-list.ts';
import { documentPage } from '../views/document.ts';

export const UI_PAGE_SIZE = 50;

export interface DocumentPageDeps {
  readonly api: ApiContext;
  readonly signedIn: MiddlewareHandler<UiEnv>;
  /** A session, a bounded form and its CSRF token. */
  readonly form: MiddlewareHandler<UiEnv>;
}

// A select left on "Any" sends an empty value: it means the filter is not set.
const withoutBlanks = (query: Readonly<Record<string, string>>): Record<string, string> =>
  Object.fromEntries(Object.entries(query).filter(([, value]) => value !== ''));

const listQuery = z.strictObject({
  status: liveDocumentStatusSchema.optional(),
  private: z.enum(PRIVATE_FILTERS).default('exclude'),
  offset: integerParam.default(0),
});

const correctionProblemsSchema = z.object({
  errors: z.array(z.object({ message: z.string() })),
});

const DOCUMENT_PARTS = ['fields', 'text'] as const;

const listPage = async (
  api: ApiContext,
  context: Context<UiEnv>,
  { title, path, status }: { title: string; path: string; status?: 'needs_review' },
): Promise<Response> => {
  const query = listQuery.parse(withoutBlanks(context.req.query()));
  const filters = {
    ...query,
    ...(status === undefined ? {} : { status }),
    limit: UI_PAGE_SIZE,
  };
  const list = await listDocuments(api, filters);
  return context.html(
    page(
      title,
      context.get('session').csrfToken,
      documentListView({ path, list, filters, statusFilter: status === undefined }),
    ),
  );
};

const problemsOf = (error: ApiError): readonly Markup[] => {
  const parsed = correctionProblemsSchema.safeParse(error.details);
  const messages = parsed.success ? parsed.data.errors.map(({ message }) => message) : [];
  return [
    notice(error.message, 'error'),
    ...messages.map((message) => html`<p class="muted">${message}</p>`),
  ];
};

export const documentPages = ({ api, signedIn, form }: DocumentPageDeps): Hono<UiEnv> => {
  const showDocument = async (
    context: Context<UiEnv>,
    id: string,
    status: 200 | 400 = 200,
    notices: readonly Markup[] = [],
  ): Promise<Response> => {
    const document = await getDocument(api, id, { include: [...DOCUMENT_PARTS] });
    const { csrfToken } = context.get('session');
    return context.html(
      page(
        document.title ?? document.original_name,
        csrfToken,
        documentPage({ document, csrfToken, notices }),
      ),
      status,
    );
  };

  return new Hono<UiEnv>()
    .get('/', (context) => context.redirect(`${UI_ROOT}/documents`, 303))
    .get('/documents', signedIn, (context) =>
      listPage(api, context, { title: 'Documents', path: `${UI_ROOT}/documents` }),
    )
    .get('/review', signedIn, (context) =>
      listPage(api, context, {
        title: 'Review queue',
        path: `${UI_ROOT}/review`,
        status: 'needs_review',
      }),
    )
    .get('/documents/:id', signedIn, (context) =>
      showDocument(
        context,
        idParam.parse(context.req.param()).id,
        200,
        context.req.query('corrected') === undefined
          ? []
          : [notice('The correction was saved. The document is processed again.')],
      ),
    )
    .post('/documents/:id', form, async (context) => {
      const { id } = idParam.parse(context.req.param());
      const current = await getDocument(api, id, { include: ['fields'] });
      const reading = readCorrection(await context.req.parseBody(), current);
      if (!reading.ok) return showDocument(context, id, 400, [notice(reading.problem, 'error')]);
      try {
        await correctDocument(api, id, reading.correction);
      } catch (error) {
        if (error instanceof ApiError && error.code === 'invalid_correction') {
          return showDocument(context, id, 400, problemsOf(error));
        }
        throw error;
      }
      return context.redirect(`${documentPath(id)}?corrected=1`, 303);
    })
    .get('/documents/:id/file', signedIn, (context) =>
      documentFileResponse(api, idParam.parse(context.req.param()).id),
    );
};
