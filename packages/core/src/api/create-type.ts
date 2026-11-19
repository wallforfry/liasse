import {
  type CreatedType,
  type CreateTypeRequest,
  createTypeRequestSchema,
} from '@liasse/contract';
import type { JsonObject } from '../db/columns.ts';
import { createType as createRegistryType } from '../registry/create-type.ts';
import type { RegistryError } from '../registry/errors.ts';
import type { ApiContext } from './context.ts';
import { typeView } from './describe-types.ts';
import { ApiError } from './errors.ts';

// What a caller needs to correct the request, in snake_case. The message alone already
// names every broken rule.
const detailsOf = (error: RegistryError): JsonObject => {
  switch (error.code) {
    case 'invalid_slug':
      return {
        slug: error.slug,
        violations: error.violations.map(({ rule, message }) => ({ rule, message })),
      };
    case 'invalid_fields':
      return {
        issues: error.issues.map(({ field, rule, message }) => ({
          ...(field === undefined ? {} : { field }),
          rule,
          message,
        })),
      };
    case 'name_taken':
      return { name: error.name, held_by: error.heldBy };
    default:
      return {};
  }
};

/**
 * Creates a type by hand, `provisional` like one the pipeline creates, under the same
 * naming rules, primitives and registry lock.
 */
export const createType = async (
  { db, embedder, schemaLanguage }: Pick<ApiContext, 'db' | 'embedder' | 'schemaLanguage'>,
  request: CreateTypeRequest,
): Promise<CreatedType> => {
  const { slug, description, parent_slug, fields } = createTypeRequestSchema.parse(request);
  const created = await createRegistryType(
    { slug, description, parentSlug: parent_slug, fields },
    { db, embedder, schemaLanguage },
  );
  if (!created.ok) {
    throw new ApiError(created.error.code, created.error.message, detailsOf(created.error));
  }
  return typeView(created.value, 0);
};
