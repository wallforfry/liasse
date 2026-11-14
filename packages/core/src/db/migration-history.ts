import { StartupError } from '../domain/errors.ts';
import type { MigrationFile } from './migration-files.ts';

export interface AppliedMigration {
  readonly hash: string;
  readonly createdAt: number;
}

export class MigrationHistoryError extends StartupError {
  override readonly name = 'MigrationHistoryError';
}

// A migration is one journal entry: its content hash at its journal date. Content alone
// is not an identity, since "add a column, drop it, add it again" repeats the same SQL.
const identityOf = ({ hash, createdAt }: AppliedMigration): string =>
  `${hash}@${String(createdAt)}`;

// Two journal entries with one identity read as one migration: the second would be applied
// on an empty database and skipped on an installed one.
const assertDistinctIdentities = (files: readonly MigrationFile[]): void => {
  const [repeat] = files.flatMap((file, index) => {
    const earlier = files.slice(0, index).find((other) => identityOf(other) === identityOf(file));
    return earlier === undefined ? [] : [{ earlier, file }];
  });
  if (repeat === undefined) return;
  throw new MigrationHistoryError(
    `Migrations ${repeat.earlier.tag} and ${repeat.file.tag} have the same content and the ` +
      'same date in the journal, so they cannot be told apart. Give the second one its own ' +
      'date, or remove it.',
  );
};

const ADD_A_NEW_ONE =
  'An applied migration is immutable: restore it and add a new migration instead.';

const assertHistoryMatchesFiles = (
  applied: readonly AppliedMigration[],
  files: readonly MigrationFile[],
): void => {
  const fileIdentities = new Set(files.map(identityOf));
  const orphans = applied.filter((migration) => !fileIdentities.has(identityOf(migration)));

  const edited = files.find((file) =>
    orphans.some((orphan) => orphan.createdAt === file.createdAt),
  );
  if (edited !== undefined) {
    throw new MigrationHistoryError(
      `Migration ${edited.tag} was modified after it was applied to this database. ` +
        ADD_A_NEW_ONE,
    );
  }

  const appliedIdentities = new Set(applied.map(identityOf));
  const redated = files.find(
    (file) =>
      !appliedIdentities.has(identityOf(file)) &&
      orphans.some((orphan) => orphan.hash === file.hash),
  );
  if (redated !== undefined) {
    throw new MigrationHistoryError(
      `Migration ${redated.tag} was given another date in the journal after it was applied ` +
        `to this database. ${ADD_A_NEW_ONE}`,
    );
  }

  if (orphans.length > 0) {
    throw new MigrationHistoryError(
      `This database records ${String(orphans.length)} applied ` +
        `${orphans.length === 1 ? 'migration' : 'migrations'} that ` +
        `${orphans.length === 1 ? 'matches' : 'match'} no migration of this version of Liasse, ` +
        'by date or by content. Either it was migrated by a newer or a different version, or an ' +
        'applied migration was rewritten: refusing to run against it.',
    );
  }
};

// Pending means "this journal entry is not recorded", never "newer than the last applied
// one": a migration written on a parallel branch can be merged after a more recent one
// was already applied.
export const pendingMigrations = (
  applied: readonly AppliedMigration[],
  files: readonly MigrationFile[],
): readonly MigrationFile[] => {
  assertDistinctIdentities(files);
  assertHistoryMatchesFiles(applied, files);
  const appliedIdentities = new Set(applied.map(identityOf));
  return files.filter((file) => !appliedIdentities.has(identityOf(file)));
};
