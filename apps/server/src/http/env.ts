import type { Context } from 'hono';

export interface AppEnv {
  readonly Variables: {
    readonly requestId: string;
  };
}

export type AppContext = Context<AppEnv>;
