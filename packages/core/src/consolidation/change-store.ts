import { and, asc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import type { JsonObject } from '../db/columns.ts';
import { typeChanges } from '../db/schema/registry.ts';
import type { ChangeKind, ChangeStatus } from '../domain/enums.ts';
import { MAX_CHANGE_RATIONALE_LENGTH } from '../domain/limits.ts';

export type ChangeTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type ChangeReader = Database | ChangeTransaction;

export interface StoredChange {
  readonly id: string;
  readonly kind: ChangeKind;
  readonly payload: JsonObject;
  readonly rationale: string;
  readonly status: ChangeStatus;
  readonly auto: boolean;
  readonly createdAt: Date;
  readonly decidedAt: Date | null;
  readonly note: string | null;
}

const CHANGE_COLUMNS = {
  id: typeChanges.id,
  kind: typeChanges.kind,
  payload: typeChanges.payload,
  rationale: typeChanges.rationale,
  status: typeChanges.status,
  auto: typeChanges.auto,
  createdAt: typeChanges.createdAt,
  decidedAt: typeChanges.decidedAt,
  note: typeChanges.note,
} as const;

export interface NewChange {
  readonly kind: ChangeKind;
  readonly payload: JsonObject;
  readonly rationale: string;
  readonly auto: boolean;
}

// A rationale is written by a model, from documents: bounded before it is stored.
const bounded = (text: string): string => text.slice(0, MAX_CHANGE_RATIONALE_LENGTH);

export const insertChange = async (
  executor: ChangeReader,
  { rationale, ...change }: NewChange,
  decided?: { readonly status: ChangeStatus; readonly note: string },
): Promise<StoredChange> => {
  const [row] = await executor
    .insert(typeChanges)
    .values({
      ...change,
      rationale: bounded(rationale),
      ...(decided === undefined ? {} : { ...decided, decidedAt: sql`now()` }),
    })
    .returning(CHANGE_COLUMNS);
  if (row === undefined) throw new Error('The change row was not written');
  return row;
};

/** Whether a change of this kind whose payload contains this object exists in a status. */
export const hasChange = async (
  reader: ChangeReader,
  kind: ChangeKind,
  contained: JsonObject,
  statuses: readonly ChangeStatus[],
): Promise<boolean> =>
  (await reader.$count(
    typeChanges,
    and(
      eq(typeChanges.kind, kind),
      inArray(typeChanges.status, [...statuses]),
      sql`${typeChanges.payload} @> ${JSON.stringify(contained)}::jsonb`,
    ),
  )) > 0;

/** The kind of a change, read without a lock: it never changes once written. */
export const findChangeKind = async (
  reader: ChangeReader,
  id: string,
): Promise<ChangeKind | undefined> => {
  const [row] = await reader
    .select({ kind: typeChanges.kind })
    .from(typeChanges)
    .where(eq(typeChanges.id, id));
  return row?.kind;
};

/** The row is locked until the transaction ends: one decision per change. */
export const lockChange = async (
  tx: ChangeTransaction,
  id: string,
): Promise<StoredChange | undefined> => {
  const [row] = await tx
    .select(CHANGE_COLUMNS)
    .from(typeChanges)
    .where(eq(typeChanges.id, id))
    .for('update');
  return row;
};

export const closeChange = async (
  tx: ChangeTransaction,
  id: string,
  status: Exclude<ChangeStatus, 'pending'>,
  note: string | null,
): Promise<StoredChange> => {
  const [row] = await tx
    .update(typeChanges)
    .set({ status, note, decidedAt: sql`now()` })
    .where(eq(typeChanges.id, id))
    .returning(CHANGE_COLUMNS);
  if (row === undefined) throw new Error('The change row was not updated');
  return row;
};

/** A change found no longer safe by the auto-apply policy waits for approval. */
export const markUnsafe = async (tx: ChangeTransaction, id: string): Promise<void> => {
  await tx.update(typeChanges).set({ auto: false }).where(eq(typeChanges.id, id));
};

export const pendingChanges = (
  reader: ChangeReader,
  filter: SQL | undefined,
  limit: number,
): Promise<readonly StoredChange[]> =>
  reader
    .select(CHANGE_COLUMNS)
    .from(typeChanges)
    .where(and(eq(typeChanges.status, 'pending'), filter))
    .orderBy(asc(typeChanges.createdAt), asc(typeChanges.id))
    .limit(limit);
