import { sql } from 'drizzle-orm';
import { boolean, check, integer, pgTable } from 'drizzle-orm/pg-core';
import { instant, jsonObject } from '../columns.ts';

/**
 * The application settings: one row, which `singleton` keeps alone. `document` holds the
 * settings without their keys, `secrets` the keys sealed by the secret box of
 * `@liasse/core/settings`, by section. `version` counts the saves: a save names the
 * version it read, and one that read an older version changes nothing.
 */
export const settings = pgTable(
  'settings',
  {
    singleton: boolean('singleton').primaryKey().default(true),
    version: integer('version').notNull(),
    document: jsonObject('document'),
    secrets: jsonObject('secrets'),
    updatedAt: instant('updated_at').notNull().defaultNow(),
  },
  (table) => [check('settings_singleton', sql`${table.singleton}`)],
);
