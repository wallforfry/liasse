import { changeDecisionResultSchema, changeDecisionSchema } from '@liasse/contract';
import { type ApiContext, ApiError, applyChange, listChanges } from '@liasse/core/api';
import { Hono, type MiddlewareHandler } from 'hono';
import { idParam } from '../../http/query-params.ts';
import type { UiEnv } from '../guards.ts';
import { notice, page, UI_ROOT } from '../markup.ts';
import { changesPage } from '../views/changes.ts';

export interface ChangePageDeps {
  readonly api: ApiContext;
  readonly signedIn: MiddlewareHandler<UiEnv>;
  /** A session, a bounded form and its CSRF token. */
  readonly form: MiddlewareHandler<UiEnv>;
}

const DECIDED: Readonly<Record<string, string>> = {
  apply: 'The change was applied.',
  reject: 'The change was rejected.',
  refused:
    'The change could not be applied as things stand, so it was rejected; its note says why.',
};

export const changePages = ({ api, signedIn, form }: ChangePageDeps): Hono<UiEnv> =>
  new Hono<UiEnv>()
    .get('/changes', signedIn, async (context) => {
      const { csrfToken } = context.get('session');
      const decided = DECIDED[context.req.query('decided') ?? ''];
      const notices = decided === undefined ? [] : [notice(decided)];
      try {
        const listed = await listChanges(api, {});
        return await context.html(
          page('Changes', csrfToken, changesPage(listed, csrfToken, notices)),
        );
      } catch (error) {
        // The state the API gives while consolidation is not part of the build.
        if (!(error instanceof ApiError) || error.kind !== 'not_implemented') throw error;
        return context.html(page('Changes', csrfToken, notice(error.message)), 501);
      }
    })
    .post('/changes/:id', form, async (context) => {
      const { id } = idParam.parse(context.req.param());
      const { decision, note } = await context.req.parseBody();
      const parsed = changeDecisionSchema.parse({
        decision,
        ...(typeof note === 'string' && note.trim() !== '' ? { note } : {}),
      });
      const { refusal } = changeDecisionResultSchema.parse(await applyChange(api, id, parsed));
      const decided = refusal === undefined ? parsed.decision : 'refused';
      return context.redirect(`${UI_ROOT}/changes?decided=${decided}`, 303);
    });
