import {
  type DescribeTypesOptions,
  describeTypesOptionsSchema,
  type TypeList,
} from '@liasse/contract';
import { listTypes } from '../registry/read-types.ts';
import type { ApiContext } from './context.ts';

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
