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

const namesOf = ({ type, status, code }: z.infer<typeof errorFields>): readonly string[] =>
  [type, status, code].map(identifier).filter((name) => name !== undefined);

// The error type and the error code of a provider error body, as `type:code`. OpenAI,
// Mistral and Ollama send `error.type` and `error.code`, Anthropic `error.type`, Google
// `error.status` next to an `error.code` that repeats the HTTP status and is left out.
export const providerErrorCode = (
  body: unknown,
  statusCode: number | undefined,
): string | undefined => {
  const parsed = errorBody.safeParse(body);
  if (!parsed.success) return undefined;
  const { error, ...top } = parsed.data;
  const nested = namesOf(error ?? {});
  const names = [...new Set(nested.length > 0 ? nested : namesOf(top))].filter(
    (name) => name !== String(statusCode),
  );
  return names.length === 0 ? undefined : names.join(':');
};

const MAX_ISSUES = 10;
const MAX_KEYS = 5;
const UNSAFE = '?';

const propertyNames = (jsonSchema: unknown): readonly string[] => {
  if (Array.isArray(jsonSchema)) return jsonSchema.flatMap(propertyNames);
  if (typeof jsonSchema !== 'object' || jsonSchema === null) return [];
  return Object.entries(jsonSchema).flatMap(([keyword, value]: [string, unknown]) => [
    ...(keyword === 'properties' && typeof value === 'object' && value !== null
      ? Object.keys(value)
      : []),
    ...propertyNames(value),
  ]);
};

// The keys the schema itself names. Both sides are read: a schema piped into another
// declares its keys on the output side, a transformed one on the input side.
const declaredKeys = (schema: z.ZodType): ReadonlySet<string> =>
  new Set(
    (['input', 'output'] as const).flatMap((io) =>
      propertyNames(z.toJSONSchema(schema, { io, unrepresentable: 'any' })),
    ),
  );

const segment = (key: PropertyKey, declared: ReadonlySet<string>): string => {
  if (typeof key === 'number') return String(key);
  return typeof key === 'string' && declared.has(key) ? key : UNSAFE;
};

const describeIssue = (issue: z.core.$ZodIssue, declared: ReadonlySet<string>): string => {
  const path =
    issue.path.length === 0 ? '(root)' : issue.path.map((key) => segment(key, declared)).join('.');
  const keys =
    issue.code === 'unrecognized_keys'
      ? ` (${issue.keys
          .slice(0, MAX_KEYS)
          .map(() => UNSAFE)
          .join(', ')})`
      : '';
  return `${path}: ${issue.code}${keys}`;
};

// Where the output departs from the schema: the path and the code of each issue. Zod's
// own messages are left out because they can quote what the model wrote. A key the model
// chose, undeclared or under a free-key object, is shown as `?` even when it is a short
// identifier: a compact IBAN or an e-mail address is one too.
export const describeIssues = (error: z.ZodError, schema: z.ZodType): string => {
  const declared = declaredKeys(schema);
  const listed = error.issues.slice(0, MAX_ISSUES).map((issue) => describeIssue(issue, declared));
  const hidden = error.issues.length - listed.length;
  return [...listed, ...(hidden > 0 ? [`and ${String(hidden)} more`] : [])].join('; ');
};
