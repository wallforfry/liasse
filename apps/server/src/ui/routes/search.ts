import { type ApiContext, searchDocuments } from '@liasse/core/api';
import { Hono, type MiddlewareHandler } from 'hono';
import type { UiEnv } from '../guards.ts';
import { page } from '../markup.ts';
import { searchPage } from '../views/search.ts';

export interface SearchPageDeps {
  readonly api: ApiContext;
  readonly signedIn: MiddlewareHandler<UiEnv>;
}

export const searchPages = ({ api, signedIn }: SearchPageDeps): Hono<UiEnv> =>
  new Hono<UiEnv>().get('/search', signedIn, async (context) => {
    const query = (context.req.query('q') ?? '').trim();
    const includePrivate = context.req.query('private') === 'true';
    const results =
      query === ''
        ? undefined
        : await searchDocuments(api, { query, include_private: includePrivate });
    return context.html(
      page(
        'Search',
        context.get('session').csrfToken,
        searchPage({ query, includePrivate, results }),
      ),
    );
  });
