import type { Context } from 'hono';
import { html } from 'hono/html';
import { failureOf, INTERNAL } from '../http/errors.ts';
import { describeError, type Logger } from '../log.ts';
import type { UiEnv } from './guards.ts';
import { notice, publicPage, UI_ROOT } from './markup.ts';

/**
 * The failures of the API, as pages: the same status, and the message Liasse wrote for
 * it. What nobody expected is logged under the request id and shown as a 500.
 */
export const createUiErrorHandler =
  (logger: Logger) =>
  async (error: unknown, context: Context<UiEnv>): Promise<Response> => {
    const known = failureOf(error);
    if (known === undefined) {
      logger.event('request_failed', {
        request_id: context.get('requestId'),
        ...describeError(error),
      });
    }
    const { status, message } = known ?? INTERNAL;
    return context.html(
      publicPage(
        'Something went wrong',
        html`${notice(message, 'error')}
          <p><a href="${`${UI_ROOT}/documents`}">Back to the documents</a></p>`,
      ),
      status,
    );
  };
