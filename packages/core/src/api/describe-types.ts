import { z } from 'zod';
import { typeStatusSchema } from '../domain/schemas.ts';
import { fieldDefinitionSchema } from '../registry/primitives.ts';
import { listTypes } from '../registry/read-types.ts';
import type { ApiContext } from './context.ts';

export const describeTypesOptionsSchema = z.strictObject({
  status: typeStatusSchema.optional().describe('Without it, every type that is not merged.'),
  include_examples: z.boolean().default(false),
});
export type DescribeTypesOptions = z.input<typeof describeTypesOptionsSchema>;

export const typeListSchema = z.object({
  types: z.array(
    z.object({
      slug: z.string(),
      description: z.string(),
      parent_slug: z.string().nullable(),
      version: z.int(),
      status: typeStatusSchema,
      aliases: z.array(z.string()),
      fields: z.record(z.string(), fieldDefinitionSchema),
      document_count: z.int(),
      examples: z.array(z.string()).optional().describe('Titles of documents of the type.'),
    }),
  ),
});
export type TypeList = z.output<typeof typeListSchema>;

/** The registry. Descriptions and example titles come from documents: untrusted content. */
export const describeTypes = async (
  { db }: Pick<ApiContext, 'db'>,
  options: DescribeTypesOptions = {},
): Promise<TypeList> => {
  const { status, include_examples } = describeTypesOptionsSchema.parse(options);
  const types = await listTypes({ status, includeExamples: include_examples }, { db });
  return {
    types: types.map(({ slug, description, parentSlug, version, aliases, docCount, ...type }) => ({
      slug,
      description,
      parent_slug: parentSlug,
      version,
      status: type.status,
      aliases: [...aliases],
      fields: { ...type.fields },
      document_count: docCount,
      ...(type.examples === undefined ? {} : { examples: [...type.examples] }),
    })),
  };
};
