import { z } from 'zod';
import { MAX_ENUM_VALUES, MAX_IDENTIFIER_FORMAT_LENGTH } from '../domain/limits.ts';
import { isoDateSchema, moneySchema, periodSchema } from '../domain/values.ts';

const textValue = z.string().min(1);

const hasNoDuplicate = (values: readonly string[]): boolean =>
  new Set(values).size === values.length;

const enumValues = z
  .array(z.string().min(1))
  .min(1)
  .max(MAX_ENUM_VALUES)
  .refine(hasNoDuplicate, 'expected distinct enum values')
  .readonly();

const bare = <Name extends string>(name: Name) => z.strictObject({ type: z.literal(name) });

// `valueOf` takes the raw definition and parses it with its own schema: that keeps each
// row self-contained, where a lookup by `definition.type` could not be typed without a cast.
const primitive = <Definition extends z.ZodType>(
  definition: Definition,
  build: (definition: z.output<Definition>) => z.ZodType,
) => ({ definition, valueOf: (raw: unknown): z.ZodType => build(definition.parse(raw)) });

// The single definition of the primitives a type schema may use. The definition schema,
// the stored JSON Schema and the value schema of a field all derive from this table.
const SCALAR_PRIMITIVES = {
  text: primitive(bare('text'), () => textValue),
  number: primitive(bare('number'), () => z.number()),
  boolean: primitive(bare('boolean'), () => z.boolean()),
  date: primitive(bare('date'), () => isoDateSchema),
  period: primitive(bare('period'), () => periodSchema),
  money: primitive(bare('money'), () => moneySchema),
  entity: primitive(bare('entity'), () => textValue),
  enum: primitive(z.strictObject({ type: z.literal('enum'), values: enumValues }), ({ values }) =>
    z.enum(values),
  ),
  identifier: primitive(
    z.strictObject({
      type: z.literal('identifier'),
      format: z.string().min(1).max(MAX_IDENTIFIER_FORMAT_LENGTH).optional(),
    }),
    () => textValue,
  ),
} as const;

type ScalarName = keyof typeof SCALAR_PRIMITIVES;

const LIST = 'list';

const isScalarName = (name: string): name is ScalarName => Object.hasOwn(SCALAR_PRIMITIVES, name);

const scalarNames = Object.keys(SCALAR_PRIMITIVES).filter(isScalarName);

export const FIELD_PRIMITIVES: readonly (ScalarName | typeof LIST)[] = [...scalarNames, LIST];
export type FieldPrimitive = (typeof FIELD_PRIMITIVES)[number];

const atLeastOne = <Item>(items: readonly Item[]): [Item, ...Item[]] => {
  const [first, ...rest] = items;
  if (first === undefined) throw new Error('The primitive table is empty');
  return [first, ...rest];
};

const scalarDefinitionSchema = z.discriminatedUnion(
  'type',
  atLeastOne(scalarNames.map((name) => SCALAR_PRIMITIVES[name].definition)),
);
export type ScalarFieldDefinition = z.output<typeof scalarDefinitionSchema>;

// `items` is a scalar definition, so a list of lists has no representation.
const listDefinitionSchema = z.strictObject({
  type: z.literal(LIST),
  items: scalarDefinitionSchema,
});

export const fieldDefinitionSchema = z.discriminatedUnion('type', [
  ...scalarDefinitionSchema.options,
  listDefinitionSchema,
]);
export type FieldDefinition = z.output<typeof fieldDefinitionSchema>;

const scalarValueSchema = (definition: ScalarFieldDefinition): z.ZodType =>
  SCALAR_PRIMITIVES[definition.type].valueOf(definition);

export const fieldValueSchema = (definition: FieldDefinition): z.ZodType =>
  definition.type === LIST
    ? z.array(scalarValueSchema(definition.items))
    : scalarValueSchema(definition);

const parameterless = scalarNames.flatMap((name) => {
  const definition = scalarDefinitionSchema.safeParse({ type: name });
  return definition.success ? [scalarValueSchema(definition.data)] : [];
});

const untypedScalarSchema = z.union([...new Set(parameterless)]);

// What a value may be when no definition describes it: any primitive that needs no
// parameter, or a list of them.
export const untypedValueSchema = z.union([untypedScalarSchema, z.array(untypedScalarSchema)]);
