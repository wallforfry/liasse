import { StartupError } from '../domain/errors.ts';
import type { MigrationFile } from './migration-files.ts';

export interface AppliedMigration {
  readonly hash: string;
  readonly createdAt: number;
}

export class MigrationHistoryError extends StartupError {
  override readonly name = 'MigrationHistoryError';
}

const assertHistoryMatchesFiles = (
  applied: readonly AppliedMigration[],
  files: readonly MigrationFile[],
): void => {
  const fileHashes = new Set(files.map((file) => file.hash));
  const orphans = applied.filter((migration) => !fileHashes.has(migration.hash));
  const edited = files.find((file) =>
    orphans.some((orphan) => orphan.createdAt === file.createdAt),
  );
  if (edited !== undefined) {
    throw new MigrationHistoryError(
      `Migration ${edited.tag} was modified after it was applied to this database. ` +
        'An applied migration is immutable: restore the file and add a new migration instead.',
    );
  }
  if (orphans.length > 0) {
    throw new MigrationHistoryError(
      `This database records ${String(orphans.length)} applied ` +
        `${orphans.length === 1 ? 'migration' : 'migrations'} that this version of Liasse does ` +
        'not contain. It was migrated by a newer or a different version: refusing to run against it.',
    );
  }
};

// Pending means "hash not recorded", never "newer than the last applied one": a migration
// written on a parallel branch can be merged after a more recent one was already applied.
export const pendingMigrations = (
  applied: readonly AppliedMigration[],
  files: readonly MigrationFile[],
): readonly MigrationFile[] => {
  assertHistoryMatchesFiles(applied, files);
  const appliedHashes = new Set(applied.map((migration) => migration.hash));
  return files.filter((file) => !appliedHashes.has(file.hash));
};
