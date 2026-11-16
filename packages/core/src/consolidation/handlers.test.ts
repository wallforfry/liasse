import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../db/client.ts';
import { DeferJobError } from '../jobs/errors.ts';
import { jobs } from '../db/schema/jobs.ts';
import { createFakeTextModel } from '../testing/fake-text-model.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import { seedDocument, seedType, typeOf } from './consolidation.test-helper.ts';
import { createConsolidationHandlers } from './handlers.ts';
import { withConsolidationRunLock } from './run-lock.ts';

describe('the consolidate handler', () => {
  let database: TestDatabase;
  const db = () => database.db;

  beforeEach(async () => {
    database = await createTestDatabase();
  });

  afterEach(async () => {
    await database.dispose();
  });

  const handler = () => {
    const [registered] = createConsolidationHandlers({
      db: db(),
      textModel: createFakeTextModel([]),
      autoApply: 'safe',
      schemaLanguage: 'en',
    });
    if (registered === undefined) throw new Error('No consolidate handler');
    return registered;
  };

  const run = (trigger: 'nightly' | 'batch' | 'manual') =>
    handler().run({ trigger }, { signal: new AbortController().signal, attempt: 1 });

  const queuedNightly = () => db().$count(jobs, eq(jobs.kind, 'consolidate'));

  it('queues the next nightly run when a nightly run starts, and not for a batch run', async () => {
    await run('batch');
    expect(await queuedNightly()).toBe(0);
    await run('nightly');
    expect(await queuedNightly()).toBe(1);
  });

  it('leaves the work to a run already in progress, in this process or another', async () => {
    const type = await seedType(db(), { slug: 'payslip' });
    for (let index = 0; index < 5; index += 1) await seedDocument(db(), type.id);

    // The lock is held on a connection of its own, as another process would hold it.
    await withConsolidationRunLock(db(), async () => {
      await run('batch');
      expect(await typeOf(db(), type.id)).toMatchObject({ status: 'provisional' });
    });
    await run('batch');
    expect(await typeOf(db(), type.id)).toMatchObject({ status: 'stable' });
  });

  it('defers a manual run while another run is in progress, and runs it after', async () => {
    const type = await seedType(db(), { slug: 'water_bill' });
    for (let index = 0; index < 5; index += 1) await seedDocument(db(), type.id);

    await withConsolidationRunLock(db(), async () => {
      await expect(run('manual')).rejects.toBeInstanceOf(DeferJobError);
      expect(await typeOf(db(), type.id)).toMatchObject({ status: 'provisional' });
    });
    await run('manual');
    expect(await typeOf(db(), type.id)).toMatchObject({ status: 'stable' });
  });

  it('lets go of the run lock after a run, so a run of another process runs next', async () => {
    const type = await seedType(db(), { slug: 'rent_receipt' });
    for (let index = 0; index < 5; index += 1) await seedDocument(db(), type.id);
    await withConsolidationRunLock(db(), () => Promise.resolve());

    const other = createDb(database.url);
    try {
      const [registered] = createConsolidationHandlers({
        db: other.db,
        textModel: createFakeTextModel([]),
        autoApply: 'safe',
        schemaLanguage: 'en',
      });
      await registered?.run(
        { trigger: 'batch' },
        { signal: new AbortController().signal, attempt: 1 },
      );
    } finally {
      await other.close();
    }
    expect(await typeOf(db(), type.id)).toMatchObject({ status: 'stable' });
  });
});
