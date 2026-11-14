import { z } from 'zod';

// What may appear in an error or in provenance when it comes from a provider or a model:
// short identifiers. Anything else could be document text.
const IDENTIFIER = /^[A-Za-z0-9_.:/@-]{1,96}$/;

export const identifier = (value: unknown): string | undefined =>
  (typeof value === 'string' || typeof value === 'number') && IDENTIFIER.test(String(value))
    ? String(value)
    : undefined;

const errorFields = z.object({
  code: z.unknown().optional(),
  type: z.unknown().optional(),
  status: z.unknown().optional(),
});

const errorBody = errorFields.extend({ error: errorFields.optional() });

// The error type or code of a provider error body. OpenAI, Mistral and Ollama send
// `error.code` and `error.type`, Anthropic `error.type`, Google `error.status`.
export const providerErrorCode = (body: unknown): string | undefined => {
  const parsed = errorBody.safeParse(body);
  if (!parsed.success) return undefined;
  const { error, ...top } = parsed.data;
  return [error?.type, error?.status, error?.code, top.type, top.status, top.code]
    .map(identifier)
    .find((candidate) => candidate !== undefined);
};

const MAX_ISSUES = 10;
const MAX_KEYS = 5;
const UNSAFE = '?';

const segment = (key: PropertyKey): string => identifier(key) ?? UNSAFE;

const describeIssue = (issue: z.core.$ZodIssue): string => {
  const path = issue.path.length === 0 ? '(root)' : issue.path.map(segment).join('.');
  const keys =
    issue.code === 'unrecognized_keys'
      ? ` (${issue.keys.slice(0, MAX_KEYS).map(segment).join(', ')})`
      : '';
  return `${path}: ${issue.code}${keys}`;
};

// Where the output departs from the schema: the path and the code of each issue. Zod's
// own messages are left out because they can quote what the model wrote, and a key the
// model invented is named only when it is an identifier.
export const describeIssues = (error: z.ZodError): string => {
  const listed = error.issues.slice(0, MAX_ISSUES).map(describeIssue);
  const hidden = error.issues.length - listed.length;
  return [...listed, ...(hidden > 0 ? [`and ${String(hidden)} more`] : [])].join('; ');
};
