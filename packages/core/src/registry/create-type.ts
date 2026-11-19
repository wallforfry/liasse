import { MAX_TYPE_DESCRIPTION_LENGTH, type SchemaLanguage } from '@liasse/contract/domain';
import { err, ok, type Result } from '@liasse/contract/registry';
import { docTypes, entities } from '../db/schema/registry.ts';
import type { RegistryContext } from './context.ts';
import { failure, invalidFields, invalidSlug, nameTaken, type RegistryError } from './errors.ts';
import { checkTypeFields, type TypeFields } from './fields.ts';
import { type SlugContext, slugViolations } from './naming.ts';
import {
  findLiveTypeByName,
  findNameHolder,
  insertType,
  type RegisteredType,
  type RegistryReader,
  withRegistryLock,
} from './type-store.ts';

export interface CreateTypeInput {
  readonly slug: string;
  readonly description: string;
  readonly parentSlug?: string | null | undefined;
  readonly fields: unknown;
}

interface TypeDraft {
  readonly slug: string;
  readonly description: string;
  readonly parentSlug: string | null;
  readonly fields: TypeFields;
}

const slugContext = async (
  reader: RegistryReader,
  schemaLanguage: SchemaLanguage,
): Promise<SlugContext> => {
  const known = await reader
    .select({ kind: entities.kind, name: entities.canonicalName, aliases: entities.aliases })
    .from(entities);
  const types = await reader.select({ slug: docTypes.slug }).from(docTypes);
  return {
    schemaLanguage,
    entityNames: known.flatMap(({ kind, name, aliases }) =>
      [name, ...aliases].map((known) => ({ kind, name: known })),
    ),
    typeSlugs: types.map(({ slug }) => slug),
  };
};

const checkDraft = async (
  input: CreateTypeInput,
  reader: RegistryReader,
  schemaLanguage: SchemaLanguage,
): Promise<Result<TypeDraft, RegistryError>> => {
  const violations = slugViolations(input.slug, await slugContext(reader, schemaLanguage));
  if (violations.length > 0) return err(invalidSlug(input.slug, violations));
  const description = input.description.trim();
  if (description === '' || description.length > MAX_TYPE_DESCRIPTION_LENGTH) {
    return err(
      failure(
        'invalid_description',
        `A type description has between 1 and ${String(MAX_TYPE_DESCRIPTION_LENGTH)} characters.`,
      ),
    );
  }
  const fields = checkTypeFields(input.fields);
  if (!fields.ok) return err(invalidFields(fields.error));
  return ok({
    slug: input.slug,
    description,
    parentSlug: input.parentSlug ?? null,
    fields: fields.value,
  });
};

// Two levels: a type either has no parent or has a parent that has none.
const resolveParent = async (
  reader: RegistryReader,
  parentSlug: string | null,
): Promise<Result<string | null, RegistryError>> => {
  if (parentSlug === null) return ok(null);
  const parent = await findLiveTypeByName(reader, parentSlug);
  if (parent === undefined) {
    return err(failure('parent_not_found', `No type has the slug or alias "${parentSlug}".`));
  }
  return parent.parentSlug === null
    ? ok(parent.slug)
    : err(
        failure(
          'hierarchy_too_deep',
          `The type "${parent.slug}" already has the parent "${parent.parentSlug}": the hierarchy has two levels.`,
        ),
      );
};

// Answers with the slug of the parent as the registry knows it.
const checkCreatable = async (
  reader: RegistryReader,
  draft: TypeDraft,
): Promise<Result<string | null, RegistryError>> => {
  const holder = await findNameHolder(reader, draft.slug);
  if (holder !== undefined) return err(nameTaken(draft.slug, holder));
  return resolveParent(reader, draft.parentSlug);
};

export const createType = async (
  input: CreateTypeInput,
  { db, embedder, schemaLanguage, now = () => new Date() }: RegistryContext,
): Promise<Result<RegisteredType, RegistryError>> => {
  const draft = await checkDraft(input, db, schemaLanguage);
  if (!draft.ok) return draft;
  // The embedder may be a remote call: it runs outside the lock, and only for a request
  // that would pass at this point. The same checks run again under the lock.
  const early = await checkCreatable(db, draft.value);
  if (!early.ok) return early;
  const [embedding] = await embedder.embed([draft.value.description], 'passage');
  if (embedding === undefined) throw new Error('The embedder returned no embedding');
  return withRegistryLock(db, async (tx) => {
    const parentSlug = await checkCreatable(tx, draft.value);
    if (!parentSlug.ok) return parentSlug;
    return ok(
      await insertType(tx, {
        ...draft.value,
        parentSlug: parentSlug.value,
        embedding,
        createdAt: now(),
      }),
    );
  });
};
