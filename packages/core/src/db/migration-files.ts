import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

export interface MigrationFile {
  readonly tag: string;
  readonly createdAt: number;
  readonly hash: string;
  readonly statements: readonly string[];
}

const journalSchema = z.object({
  entries: z.array(z.object({ tag: z.string().min(1), when: z.number().int() })),
});

const STATEMENT_BREAKPOINT = '--> statement-breakpoint';

// Journal layout, statement separator and content hash are those of drizzle-kit and of
// Drizzle's own migrator, so a database migrated here stays readable by their tooling.
export const readMigrationFiles = (migrationsFolder: string): readonly MigrationFile[] =>
  journalSchema
    .parse(JSON.parse(readFileSync(join(migrationsFolder, 'meta', '_journal.json'), 'utf8')))
    .entries.map(({ tag, when }) => {
      const content = readFileSync(join(migrationsFolder, `${tag}.sql`), 'utf8');
      return {
        tag,
        createdAt: when,
        hash: createHash('sha256').update(content).digest('hex'),
        statements: content.split(STATEMENT_BREAKPOINT),
      };
    });
