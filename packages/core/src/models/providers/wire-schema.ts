import type { ZodType } from 'zod';
import { OutputSchemaError } from '../errors.ts';
import type { Sdk } from './lazy.ts';

// The JSON Schema a provider is constrained with. It carries no validator: the SDK only
// forwards it, and the Zod schema validates the output. `$schema` is dropped because no
// provider documents it among the keywords it accepts.
export const wireSchema = async (sdk: Sdk, schema: ZodType) => {
  const converted = Promise.resolve()
    .then(() => sdk.zodSchema(schema).jsonSchema)
    .catch((cause: unknown) => {
      throw new OutputSchemaError(cause);
    });
  const { $schema: _dialect, ...keywords } = await converted;
  return sdk.jsonSchema(keywords);
};
