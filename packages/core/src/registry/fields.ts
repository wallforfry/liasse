import type { z } from 'zod';
import { MAX_FIELDS_PER_TYPE } from '../domain/limits.ts';
import { fieldNameViolations, type NamingRule } from './naming.ts';
import { isPlainRecord } from './own.ts';
import { type FieldDefinition, fieldDefinitionSchema } from './primitives.ts';
import { err, ok, type Result } from './result.ts';

export type TypeFields = Readonly<Record<string, FieldDefinition>>;

export type FieldRule = NamingRule | 'invalid_definition' | 'too_many_fields' | 'not_an_object';

export interface FieldIssue {
  // Absent when the issue concerns the set of fields as a whole.
  readonly field?: string;
  readonly rule: FieldRule;
  readonly message: string;
}

const describePath = (field: string, path: readonly PropertyKey[]): string =>
  [field, ...path.map(String)].join('.');

const definitionIssues = (field: string, error: z.ZodError): readonly FieldIssue[] =>
  error.issues.map((issue) => ({
    field,
    rule: 'invalid_definition',
    message: `Definition of "${describePath(field, issue.path)}": ${issue.message}.`,
  }));

type CheckedField = Result<readonly [string, FieldDefinition], readonly FieldIssue[]>;

export const checkField = (name: string, raw: unknown): CheckedField => {
  const naming = fieldNameViolations(name).map(({ rule, message }) => ({
    field: name,
    rule,
    message,
  }));
  const definition = fieldDefinitionSchema.safeParse(raw);
  if (!definition.success) return err([...naming, ...definitionIssues(name, definition.error)]);
  return naming.length === 0 ? ok([name, definition.data]) : err(naming);
};

// Reports every broken rule at once, so one round of feedback is enough to fix a proposal.
export const checkTypeFields = (input: unknown): Result<TypeFields, readonly FieldIssue[]> => {
  if (!isPlainRecord(input)) {
    return err([
      {
        rule: 'not_an_object',
        message: 'Fields must be an object mapping each field name to its definition.',
      },
    ]);
  }
  const checked = Object.entries(input).map(([name, definition]) => checkField(name, definition));
  const count: readonly FieldIssue[] =
    checked.length <= MAX_FIELDS_PER_TYPE
      ? []
      : [
          {
            rule: 'too_many_fields',
            message: `A type has at most ${String(MAX_FIELDS_PER_TYPE)} fields; this one has ${String(checked.length)}.`,
          },
        ];
  const issues = [...count, ...checked.flatMap((field) => (field.ok ? [] : field.error))];
  if (issues.length > 0) return err(issues);
  return ok(Object.fromEntries(checked.flatMap((field) => (field.ok ? [field.value] : []))));
};
