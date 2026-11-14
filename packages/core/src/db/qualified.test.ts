import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { describe, expect, it } from 'vitest';
import { qualified } from './columns.ts';
import { documents } from './schema/documents.ts';

const db = drizzle.mock();

describe('qualified', () => {
  // The upstream fact the helper exists for: in the selection of a query over one table,
  // drizzle-orm prints a column given to `sql` by its bare name. Inside a subquery that
  // reads the same table under an alias, the bare name designates the alias.
  it('is needed in the selection of a query over one table', () => {
    const bare = db
      .select({ state: sql`${documents.state}` })
      .from(documents)
      .toSQL().sql;
    expect(bare).toBe('select "state" from "documents"');
    const named = db
      .select({ state: sql`${qualified(documents.state)}` })
      .from(documents)
      .toSQL().sql;
    expect(named).toBe('select "documents"."state" from "documents"');
  });

  it('names a column of an alias', () => {
    const aliased = db
      .select({ state: sql`${qualified(documents.state, 'amended')}` })
      .from(documents)
      .toSQL().sql;
    expect(aliased).toBe('select "amended"."state" from "documents"');
  });
});
