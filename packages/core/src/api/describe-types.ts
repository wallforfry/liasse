import {
  type CreatedType,
  type DescribeTypesOptions,
  describeTypesOptionsSchema,
  type TypeList,
} from '@liasse/contract';
import { listTypes } from '../registry/read-types.ts';
import type { RegisteredType } from '../registry/type-store.ts';
import type { ApiContext } from './context.ts';

export const typeView = (type: RegisteredType, documentCount: number): CreatedType => ({
  slug: type.slug,
  description: type.description,
  parent_slug: type.parentSlug,
  version: type.version,
  status: type.status,
  aliases: [...type.aliases],
  fields: { ...type.fields },
  document_count: documentCount,
});

/** The registry. Descriptions and example titles come from documents: untrusted content. */
export const describeTypes = async (
  { db }: Pick<ApiContext, 'db'>,
  options: DescribeTypesOptions = {},
): Promise<TypeList> => {
  const { status, include_examples, include_private } = describeTypesOptionsSchema.parse(options);
  const types = await listTypes(
    { status, includeExamples: include_examples, includePrivate: include_private },
    { db },
  );
  return {
    types: types.map(({ docCount, examples, ...type }) => ({
      ...typeView(type, docCount),
      ...(examples === undefined ? {} : { examples: [...examples] }),
    })),
  };
};
