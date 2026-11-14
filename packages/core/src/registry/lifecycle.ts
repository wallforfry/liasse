import { and, eq, ne } from 'drizzle-orm';
import { docTypes } from '../db/schema/registry.ts';
import type { TypeStatus } from '../domain/enums.ts';
import type { RegistryWriteContext } from './context.ts';
import {
  failure,
  invalidAlias,
  nameTaken,
  type RegistryError,
  typeMerged,
  typeNotFound,
} from './errors.ts';
import { aliasViolations } from './naming.ts';
import { err, ok, type Result } from './result.ts';
import {
  findNameHolder,
  findTypeById,
  type RegisteredType,
  type RegistryTransaction,
  updateTypeAttributes,
  withRegistryLock,
} from './type-store.ts';

const editableType = async (
  tx: RegistryTransaction,
  typeId: string,
): Promise<Result<RegisteredType, RegistryError>> => {
  const type = await findTypeById(tx, typeId);
  if (type === undefined) return err(typeNotFound(typeId));
  return type.status === 'merged' ? err(typeMerged(type.slug)) : ok(type);
};

// `merged` is the outcome of `markMerged` alone: it also moves the names of the type.
export const setStatus = (
  typeId: string,
  status: TypeStatus,
  { db }: RegistryWriteContext,
): Promise<Result<RegisteredType, RegistryError>> =>
  withRegistryLock(db, async (tx) => {
    if (status === 'merged') {
      return err(
        failure('invalid_status', 'A type becomes merged through a merge, never directly.'),
      );
    }
    const type = await editableType(tx, typeId);
    if (!type.ok) return type;
    return ok(await updateTypeAttributes(tx, typeId, { status }));
  });

export const addAlias = (
  typeId: string,
  alias: string,
  { db }: RegistryWriteContext,
): Promise<Result<RegisteredType, RegistryError>> =>
  withRegistryLock(db, async (tx) => {
    const violations = aliasViolations(alias);
    if (violations.length > 0) return err(invalidAlias(alias, violations));
    const type = await editableType(tx, typeId);
    if (!type.ok) return type;
    const holder = await findNameHolder(tx, alias);
    if (holder !== undefined) return err(nameTaken(alias, holder));
    return ok(await updateTypeAttributes(tx, typeId, { aliases: [...type.value.aliases, alias] }));
  });

// A merged child no longer stands under its parent: its names resolve to its target.
const liveChildOf = (type: RegisteredType) =>
  and(eq(docTypes.parentSlug, type.slug), ne(docTypes.status, 'merged'));

const hasChildren = async (tx: RegistryTransaction, type: RegisteredType): Promise<boolean> =>
  (await tx.$count(docTypes, liveChildOf(type))) > 0;

// The children of the source follow it to the target. When the target is itself one of
// them, it takes the place of the source at the top.
const targetParent = async (
  tx: RegistryTransaction,
  source: RegisteredType,
  target: RegisteredType,
): Promise<Result<string | null, RegistryError>> => {
  if (target.parentSlug === source.slug) return ok(null);
  if (target.parentSlug !== null && (await hasChildren(tx, source))) {
    return err(
      failure(
        'hierarchy_too_deep',
        `"${source.slug}" has child types and "${target.slug}" has the parent "${target.parentSlug}": the merge would make a third level.`,
      ),
    );
  }
  return ok(target.parentSlug);
};

// A registry write and nothing more: it records no `type_changes` row, queues no
// re-extraction and leaves the documents of the source where they are. Applying a merge
// change of consolidation moves them in the transaction it gives here.
export const markMerged = (
  sourceId: string,
  targetId: string,
  { db }: RegistryWriteContext,
): Promise<Result<RegisteredType, RegistryError>> =>
  withRegistryLock(db, async (tx) => {
    if (sourceId === targetId) {
      return err(failure('invalid_merge', 'A type cannot be merged into itself.'));
    }
    const source = await editableType(tx, sourceId);
    if (!source.ok) return source;
    const target = await editableType(tx, targetId);
    if (!target.ok) return target;
    const parentSlug = await targetParent(tx, source.value, target.value);
    if (!parentSlug.ok) return parentSlug;
    await tx
      .update(docTypes)
      .set({ parentSlug: target.value.slug })
      .where(and(liveChildOf(source.value), ne(docTypes.id, targetId)));
    await updateTypeAttributes(tx, sourceId, { status: 'merged', aliases: [] });
    return ok(
      await updateTypeAttributes(tx, targetId, {
        parentSlug: parentSlug.value,
        aliases: [...target.value.aliases, source.value.slug, ...source.value.aliases],
      }),
    );
  });
