import {
  type SecretUpdate,
  type SetupAccount,
  setupAccountSchema,
  setupRequestSchema,
  settingsSchema,
} from '@liasse/contract';
import { draftOf, type SettingsSection, type SettingsValues } from '../settings/settings-form.ts';
import {
  type Issues,
  issuesFrom,
  NO_ISSUES,
  validate,
  type Validation,
} from '../settings/settings-validation.ts';

/** The account form, as typed. */
export interface AccountValues {
  readonly name: string;
  readonly email: string;
  readonly password: string;
  readonly confirmation: string;
}

export const EMPTY_ACCOUNT: AccountValues = { name: '', email: '', password: '', confirmation: '' };

const pathOf = (path: readonly PropertyKey[]): string => path.map(String).join('.');

/** The token as pasted, without the blanks a copy from a terminal carries around it. */
export const validateToken = (
  token: string,
): { readonly valid: true; readonly token: string } | { readonly valid: false } => {
  const parsed = setupRequestSchema.shape.token.safeParse(token.trim());
  return parsed.success ? { valid: true, token: parsed.data } : { valid: false };
};

export type AccountValidation =
  | { readonly valid: true; readonly account: SetupAccount }
  | { readonly valid: false; readonly issues: Issues };

/** The account read by the schema the server reads it with, and the password typed twice. */
export const validateAccount = ({
  name,
  email,
  password,
  confirmation,
}: AccountValues): AccountValidation => {
  const parsed = setupAccountSchema.safeParse({ name, email: email.trim(), password });
  const issues = [
    ...(parsed.success
      ? []
      : parsed.error.issues.map((issue) => ({ path: pathOf(issue.path), message: issue.message }))),
    ...(confirmation === password
      ? []
      : [{ path: 'confirmation', message: 'The two passwords differ.' }]),
  ];
  if (parsed.success && issues.length === 0) return { valid: true, account: parsed.data };
  return { valid: false, issues: issuesFrom(issues) };
};

const keyOf = (update: SecretUpdate): string | undefined =>
  update.action === 'replace' ? update.value : undefined;

/**
 * The form read as the settings the server will hold. Before the first account no key is
 * stored, so a key a provider needs must be given here: the settings schema says which.
 */
export const validateSetupSettings = (values: SettingsValues): Validation => {
  const drafted = validate(values);
  const input = draftOf(values);
  const settings = settingsSchema.safeParse({
    ...input,
    llm: { ...input.llm, api_key: keyOf(input.llm.api_key) },
    embedding: { ...input.embedding, api_key: keyOf(input.embedding.api_key) },
    hindsight: { ...input.hindsight, api_key: keyOf(input.hindsight.api_key) },
  });
  if (drafted.valid && settings.success) return drafted;
  return {
    valid: false,
    issues: issuesFrom([
      ...(drafted.valid ? [] : [...drafted.issues].map(([path, message]) => ({ path, message }))),
      ...(settings.success
        ? []
        : settings.error.issues.map((issue) => ({
            path: pathOf(issue.path),
            message: issue.message,
          }))),
    ]),
  };
};

/** The marks of `section` only: a step answers for its own fields. */
export const sectionIssues = (validation: Validation, section: SettingsSection): Issues =>
  validation.valid
    ? NO_ISSUES
    : new Map([...validation.issues].filter(([path]) => path.startsWith(`${section}.`)));
