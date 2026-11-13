import { z } from 'zod';
import { embeddingSection, llmSection } from './model-sections.ts';
import { hindsightSection, pipelineSection } from './pipeline-sections.ts';
import { authSection, databaseSection, serverSection, storageSection } from './server-sections.ts';

const SECTIONS = {
  server: serverSection,
  database: databaseSection,
  storage: storageSection,
  llm: llmSection,
  embedding: embeddingSection,
  pipeline: pipelineSection,
  hindsight: hindsightSection,
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
    llm: SECTIONS.llm.safeParse(env),
    embedding: SECTIONS.embedding.safeParse(env),
    pipeline: SECTIONS.pipeline.safeParse(env),
    hindsight: SECTIONS.hindsight.safeParse(env),
    auth: SECTIONS.auth.safeParse(env),
  };
  Object.values(parsed)
    .flatMap((result) => (result.success ? [] : result.error.issues))
    .forEach(({ path, message }) => {
      ctx.addIssue({ code: 'custom', path: [...path], message });
    });
  if (
    !parsed.server.success ||
    !parsed.database.success ||
    !parsed.storage.success ||
    !parsed.llm.success ||
    !parsed.embedding.success ||
    !parsed.pipeline.success ||
    !parsed.hindsight.success ||
    !parsed.auth.success
  ) {
    return z.NEVER;
  }
  return Object.freeze({
    server: parsed.server.data,
    database: parsed.database.data,
    storage: parsed.storage.data,
    llm: parsed.llm.data,
    embedding: parsed.embedding.data,
    pipeline: parsed.pipeline.data,
    hindsight: parsed.hindsight.data,
    auth: parsed.auth.data,
  });
});

export type Config = z.output<typeof configSchema>;
