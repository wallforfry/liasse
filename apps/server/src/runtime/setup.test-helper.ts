import { type SetupRequestInput, setupStatusSchema } from '@liasse/contract';
import { createFakeModelFactories, SYNTHETIC_SETTINGS } from '@liasse/core/testing';
import { z } from 'zod';
import type { Runtime } from './create-runtime.ts';
import type { RuntimeHarness } from './runtime.test-helper.ts';

export const setupModels = createFakeModelFactories();

const errorSchema = z.object({ error: z.object({ code: z.string() }) });
const TOKEN_LINE =
  /^Notice: no account exists yet\. Open (\S+) to create the first one, with this setup token: (\S+) \(/;

export const SETUP_ACCOUNT = {
  name: 'Synthetic Owner',
  email: 'Owner@Example.com',
  password: 'synthetic-owner-password',
} as const;

/** Requests of an onboarding, which carry no credential, and the tokens the runtime printed. */
export const onboardingOf = (harness: RuntimeHarness) => {
  const urlOf = (runtime: Runtime, path: string): string =>
    `http://127.0.0.1:${String(runtime.port)}${path}`;
  const post = async (
    runtime: Runtime,
    path: string,
    body: unknown,
    headers: Readonly<Record<string, string>> = {},
  ) =>
    fetch(urlOf(runtime, path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  const tokenLines = (): readonly RegExpExecArray[] =>
    harness.lines().flatMap((line) => {
      const match = TOKEN_LINE.exec(line);
      return match === null ? [] : [match];
    });
  const printedTokens = (): readonly string[] =>
    tokenLines().flatMap(([, , token]) => (token === undefined ? [] : [token]));
  return {
    urlOf,
    post,
    status: async (runtime: Runtime) =>
      setupStatusSchema.parse(await (await fetch(urlOf(runtime, '/api/setup'))).json()),
    codeOf: async (response: Response) => errorSchema.parse(await response.json()).error.code,
    onboardingUrl: (): string | undefined => tokenLines()[0]?.[1],
    printedTokens,
    tokenOf: (): string => {
      const token = printedTokens().at(-1);
      if (token === undefined) throw new Error('the server printed no setup token');
      return token;
    },
    setupOf: (
      token: string,
      account: SetupRequestInput['account'] = SETUP_ACCOUNT,
      settings: SetupRequestInput['settings'] = SYNTHETIC_SETTINGS,
    ) => ({ token, account, settings }),
  };
};
