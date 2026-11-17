import { z } from 'zod';
import { embeddingSection, resourcesSection } from './process-sections.ts';
import { REMOVED_ENV } from './removed.ts';
import { authSection, databaseSection, serverSection, storageSection } from './server-sections.ts';

const SECTIONS = {
  server: serverSection,
  database: databaseSection,
  storage: storageSection,
  embedding: embeddingSection,
  resources: resourcesSection,
  auth: authSection,
} as const;

export const CONFIG_ENV_KEYS: readonly string[] = Object.values(SECTIONS).flatMap((section) =>
  Object.keys(section.in.shape),
);

type Env = Readonly<Record<string, string | undefined>>;

// Compose and container runtimes pass unset variables as empty strings.
const withoutEmptyValues = (env: Env): Env =>
  Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ''));

// Every section parses the same environment on its own, so one invalid variable
// never hides the problems of another section.
export const configSchema = z.record(z.string(), z.string().optional()).transform((rawEnv, ctx) => {
  const env = withoutEmptyValues(rawEnv);
  const parsed = {
    server: SECTIONS.server.safeParse(env),
    database: SECTIONS.database.safeParse(env),
    storage: SECTIONS.storage.safeParse(env),
    embedding: SECTIONS.embedding.safeParse(env),
    resources: SECTIONS.resources.safeParse(env),
    auth: SECTIONS.auth.safeParse(env),
  };
  const removed = [...REMOVED_ENV].filter(([key]) => env[key] !== undefined);
  removed.forEach(([key, message]) => {
    ctx.addIssue({ code: 'custom', path: [key], message });
  });
  Object.values(parsed)
    .flatMap((result) => (result.success ? [] : result.error.issues))
    .forEach(({ path, message }) => {
      ctx.addIssue({ code: 'custom', path: [...path], message });
    });
  if (
    removed.length > 0 ||
    !parsed.server.success ||
    !parsed.database.success ||
    !parsed.storage.success ||
    !parsed.embedding.success ||
    !parsed.resources.success ||
    !parsed.auth.success
  ) {
    return z.NEVER;
  }
  return Object.freeze({
    server: parsed.server.data,
    database: parsed.database.data,
    storage: parsed.storage.data,
    embedding: parsed.embedding.data,
    resources: parsed.resources.data,
    auth: parsed.auth.data,
  });
});

export type Config = z.output<typeof configSchema>;
