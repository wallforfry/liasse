import { z } from 'zod';

const SNAKE_CASE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null;

// Every property name of a JSON Schema, at any depth, as the path that leads to it.
const propertyPaths = (node: unknown, at: string): readonly string[] => {
  if (Array.isArray(node))
    return node.flatMap((item, index) => propertyPaths(item, `${at}[${String(index)}]`));
  if (!isRecord(node)) return [];
  const properties = isRecord(node.properties) ? Object.keys(node.properties) : [];
  return [
    ...properties.map((key) => `${at}.${key}`),
    ...Object.entries(node).flatMap(([key, child]) => propertyPaths(child, `${at}/${key}`)),
  ];
};

/** The path of every key a schema reads (`input`) or writes (`output`), at any depth. */
export const wireKeyPaths = (schema: z.ZodType, io: 'input' | 'output'): readonly string[] =>
  propertyPaths(z.toJSONSchema(schema, { io, unrepresentable: 'any' }), '');

/** The paths whose last key is not snake_case, the casing of every key on the wire. */
export const notSnakeCase = (paths: readonly string[]): readonly string[] =>
  paths.filter((path) => !SNAKE_CASE.test(path.slice(path.lastIndexOf('.') + 1)));
