import { and, arrayContains, eq, ne, or, sql } from 'drizzle-orm';
import { PgTransaction } from 'drizzle-orm/pg-core';
import type { Database } from '../db/client.ts';
import { assertReadCommitted, READ_COMMITTED } from '../db/isolation.ts';
import { docTypes } from '../db/schema/registry.ts';
import type { TypeStatus } from '../domain/enums.ts';
import type { Embedding } from '../models/ports.ts';
import type { TypeFields } from './fields.ts';
import { parseTypeSchema, renderTypeSchema } from './stored-schema.ts';

export type RegistryTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type RegistryReader = Database | RegistryTransaction;

export interface RegisteredType {
  readonly id: string;
  readonly slug: string;
  readonly description: string;
  readonly fields: TypeFields;
  readonly version: number;
  readonly status: TypeStatus;
  readonly parentSlug: string | null;
  readonly aliases: readonly string[];
}

// The embedding is left out: no reader of a type needs its few hundred numbers.
export const TYPE_COLUMNS = {
  id: docTypes.id,
  slug: docTypes.slug,
  description: docTypes.description,
  schema: docTypes.schema,
  version: docTypes.version,
  status: docTypes.status,
  parentSlug: docTypes.parentSlug,
  aliases: docTypes.aliases,
} as const;

interface TypeRow {
  readonly id: string;
  readonly slug: string;
  readonly description: string;
  readonly schema: unknown;
  readonly version: number;
  readonly status: TypeStatus;
  readonly parentSlug: string | null;
  readonly aliases: readonly string[];
}

// A row whose schema was written around the registry throws here instead of spreading.
export const toRegisteredType = ({ schema, ...row }: TypeRow): RegisteredType => ({
  ...row,
  fields: parseTypeSchema(schema),
});

// A database, or a transaction the caller has opened and will commit itself.
export type RegistryExecutor = Database | RegistryTransaction;

const isTransaction = (executor: RegistryExecutor): executor is RegistryTransaction =>
  executor instanceof PgTransaction;

const LOCK = sql`SELECT pg_advisory_xact_lock(hashtext('liasse.registry'))`;

// Every registry write runs under this one lock. Quota, name uniqueness across slugs and
// aliases, hierarchy depth and version bumps all read before they write, and no unique
// index can express them; writes are rare enough that serializing them costs nothing.
//
// Given a transaction, the lock is taken in it and held until the caller commits or rolls
// back, and the work runs in a savepoint: a consolidation change moves documents and
// writes the registry in one transaction.
export const withRegistryLock = async <Outcome>(
  executor: RegistryExecutor,
  work: (tx: RegistryTransaction) => Promise<Outcome>,
): Promise<Outcome> => {
  if (isTransaction(executor)) {
    await assertReadCommitted(executor, 'Types');
    await executor.execute(LOCK);
    return executor.transaction(work);
  }
  return executor.transaction(
    async (tx) => {
      await tx.execute(LOCK);
      return work(tx);
    },
    // A snapshot taken before the lock was granted would hide what the previous holder
    // committed, so the level is set here whatever the default of the database.
    { isolationLevel: READ_COMMITTED },
  );
};

const firstType = (rows: readonly TypeRow[]): RegisteredType | undefined => {
  const [row] = rows;
  return row === undefined ? undefined : toRegisteredType(row);
};

export const findTypeById = async (
  reader: RegistryReader,
  id: string,
): Promise<RegisteredType | undefined> =>
  firstType(await reader.select(TYPE_COLUMNS).from(docTypes).where(eq(docTypes.id, id)));

const holdsName = (name: string) =>
  or(eq(docTypes.slug, name), arrayContains(docTypes.aliases, [name]));

// A merged type hands its slug and aliases to its target, so a name has at most one
// holder that is not merged, however long the chain of merges behind it.
export const findLiveTypeByName = async (
  reader: RegistryReader,
  name: string,
): Promise<RegisteredType | undefined> =>
  firstType(
    await reader
      .select(TYPE_COLUMNS)
      .from(docTypes)
      .where(and(ne(docTypes.status, 'merged'), holdsName(name))),
  );

export const findNameHolder = async (
  reader: RegistryReader,
  name: string,
): Promise<string | undefined> => {
  const [holder] = await reader
    .select({ slug: docTypes.slug })
    .from(docTypes)
    .where(holdsName(name))
    .orderBy(sql`${docTypes.status} = 'merged'`);
  return holder?.slug;
};

export interface NewType {
  readonly slug: string;
  readonly description: string;
  readonly parentSlug: string | null;
  readonly fields: unknown;
  readonly embedding: Embedding;
  readonly createdAt: Date;
}

const returned = (rows: readonly TypeRow[]): RegisteredType => {
  const type = firstType(rows);
  if (type === undefined) throw new Error('The type row was not written');
  return type;
};

export const insertType = async (
  tx: RegistryTransaction,
  { fields, createdAt, ...values }: NewType,
): Promise<RegisteredType> =>
  returned(
    await tx
      .insert(docTypes)
      .values({ ...values, schema: renderTypeSchema(fields), createdAt, updatedAt: createdAt })
      .returning(TYPE_COLUMNS),
  );

// A change of schema is a new version: the two are written together or not at all.
export const updateTypeFields = async (
  tx: RegistryTransaction,
  type: RegisteredType,
  fields: unknown,
): Promise<RegisteredType> =>
  returned(
    await tx
      .update(docTypes)
      .set({ schema: renderTypeSchema(fields), version: type.version + 1 })
      .where(eq(docTypes.id, type.id))
      .returning(TYPE_COLUMNS),
  );

export interface TypeAttributes {
  readonly status?: TypeStatus;
  readonly aliases?: readonly string[];
  readonly parentSlug?: string | null;
}

export const updateTypeAttributes = async (
  tx: RegistryTransaction,
  id: string,
  attributes: TypeAttributes,
): Promise<RegisteredType> =>
  returned(
    await tx.update(docTypes).set(attributes).where(eq(docTypes.id, id)).returning(TYPE_COLUMNS),
  );
