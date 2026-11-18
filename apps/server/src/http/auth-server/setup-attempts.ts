import type { Database } from '@liasse/core/db';
import type { ClientAddressResolver } from '@liasse/core/network';
import { countSetupAttempt } from '@liasse/core/setup';
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../env.ts';
import { failure, respondWith } from '../errors.ts';
import { clientAddressOf } from './client-address.ts';

const TOO_MANY = failure(
  'too_many_attempts',
  'Too many attempts at the setup token from this address. Wait, then try again.',
);

/**
 * Counts each request that presents the setup token against the address of its client,
 * and refuses those past the limit, before the token is compared.
 */
export const setupAttempts =
  (db: Database, resolveClientAddress: ClientAddressResolver): MiddlewareHandler<AppEnv> =>
  async (context, next) => {
    const verdict = await countSetupAttempt(db, clientAddressOf(context, resolveClientAddress));
    if (verdict.allowed) {
      await next();
      return;
    }
    context.header('Retry-After', String(verdict.retryAfterSeconds));
    return respondWith(context, TOO_MANY);
  };
