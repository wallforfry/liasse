import type { ApiContext } from '@liasse/core/api';
import type { Context } from 'hono';

export interface AppEnv {
  readonly Variables: {
    readonly requestId: string;
    /** Set by `authenticated`: the context of the settings in force when the request came. */
    readonly api: ApiContext;
    /** Set by the session cookie when it lets a request through: the session's id. */
    readonly sessionId: string;
  };
}

export type AppContext = Context<AppEnv>;
