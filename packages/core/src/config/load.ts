import { StartupError } from '../domain/errors.ts';
import { type Config, configSchema } from './schema.ts';

export class ConfigError extends StartupError {
  override readonly name = 'ConfigError';
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(['Invalid configuration:', ...problems.map((problem) => `  - ${problem}`)].join('\n'));
    this.problems = problems;
  }
}

// Only the variable name and Zod's message are reported: a rejected value may be a secret.
// `process.env` is an exotic object that Zod does not accept as a record, hence the copy.
export const loadConfig = (
  env: Readonly<Record<string, string | undefined>> = process.env,
): Config => {
  const result = configSchema.safeParse({ ...env });
  if (result.success) return result.data;
  throw new ConfigError(
    result.error.issues.map(({ path, message }) => `${path.join('.')}: ${message}`),
  );
};
