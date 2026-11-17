import { type SettingsDraft, settingsDraftSchema } from '@liasse/contract';
import { draftOf, type SettingsValues } from './settings-form.ts';

/** Messages by dotted path, such as `llm.base_url`: the first one of each path. */
export type Issues = ReadonlyMap<string, string>;

export const NO_ISSUES: Issues = new Map();

interface Issue {
  readonly path: string;
  readonly message: string;
}

export const issuesFrom = (issues: readonly Issue[]): Issues =>
  issues.reduce<Issues>(
    (found, { path, message }) => (found.has(path) ? found : new Map([...found, [path, message]])),
    NO_ISSUES,
  );

/** The message of `path` or of a part of it, such as `llm.api_key.value` for `llm.api_key`. */
export const issueAt = (issues: Issues, path: string): string | undefined =>
  [...issues].find(([key]) => key === path || key.startsWith(`${path}.`))?.[1];

const KEYED_SECTIONS = ['llm', 'embedding', 'hindsight'] as const;

/** The server refuses to keep a key it can no longer open, and says so only on save. */
const keptUnreadableKeys = (
  values: SettingsValues,
  draft: ReturnType<typeof draftOf>,
): readonly Issue[] =>
  KEYED_SECTIONS.filter(
    (section) =>
      values[section].api_key.state === 'unreadable' && draft[section].api_key.action === 'keep',
  ).map((section) => ({
    path: `${section}.api_key`,
    message: 'This key no longer opens under the current AUTH_SECRET: replace or clear it.',
  }));

export type Validation =
  | { readonly valid: true; readonly draft: SettingsDraft }
  | { readonly valid: false; readonly issues: Issues };

/** The form read by the schema the server reads it with. */
export const validate = (values: SettingsValues): Validation => {
  const input = draftOf(values);
  const result = settingsDraftSchema.safeParse(input);
  const issues = [
    ...(result.success
      ? []
      : result.error.issues.map(({ path, message }) => ({
          path: path.map(String).join('.'),
          message,
        }))),
    ...keptUnreadableKeys(values, input),
  ];
  if (result.success && issues.length === 0) return { valid: true, draft: result.data };
  return { valid: false, issues: issuesFrom(issues) };
};
