import type { AutoApplyMode } from '@liasse/contract/domain';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedEntity } from '../entities/support.test-helper.ts';
import { docTypes, entities } from '../db/schema/registry.ts';
import {
  createFakeTextModel,
  type FakeTextModel,
  type FakeTextRequest,
} from '../testing/fake-text-model.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import {
  changesOf,
  documentOf,
  queuedReextractions,
  seedChange,
  seedDocument,
  seedType,
  typeOf,
} from './consolidation.test-helper.ts';
import { runConsolidation } from './run.ts';

const isMergeCall = ({ system }: FakeTextRequest) => system.includes('from drifting');
const isPromotionCall = ({ system }: FakeTextRequest) => system.includes('outside its schema');

interface Script {
  readonly merge?: (request: FakeTextRequest) => unknown;
  readonly promote?: (request: FakeTextRequest) => unknown;
}

const modelOf = ({ merge, promote }: Script): FakeTextModel =>
  createFakeTextModel((request) => {
    if (isMergeCall(request) && merge !== undefined) return merge(request);
    if (isPromotionCall(request) && promote !== undefined) return promote(request);
    throw new Error(`Unexpected call: ${request.system.slice(0, 60)}`);
  });

const ELECTRICITY = 'Electricity bill from a supplier for a home';

describe('a run of consolidation', () => {
  let database: TestDatabase;
  const db = () => database.db;

  beforeEach(async () => {
    database = await createTestDatabase();
  });

  afterEach(async () => {
    await database.dispose();
  });

  const run = (textModel: FakeTextModel, autoApply: AutoApplyMode = 'safe') =>
    runConsolidation({ db: db(), textModel, autoApply, schemaLanguage: 'en' });

  const twins = async (status: 'provisional' | 'stable' = 'provisional') => {
    const kept = await seedType(db(), {
      slug: 'electricity_bill',
      description: ELECTRICITY,
      fields: { meter_id: { type: 'identifier' } },
    });
    const absorbed = await seedType(db(), {
      slug: 'power_bill',
      description: ELECTRICITY,
      fields: { meter: { type: 'identifier' } },
      status,
    });
    return { kept, absorbed };
  };

  const merging = (target: string, confidence = 0.95) => ({
    merge: () => ({
      decision: 'merge',
      target,
      field_mapping: [{ source_field: 'meter', target_field: 'meter_id' }],
      confidence,
      rationale: 'Both are electricity bills.',
    }),
  });

  describe('merge candidates', () => {
    it('merges two provisional types alone when the model is sure and the mapping lossless', async () => {
      const { kept, absorbed } = await twins();
      const document = await seedDocument(db(), absorbed.id, {
        title: 'Public synthetic bill',
        fields: { meter: 'PDL-9' },
      });
      await seedDocument(db(), absorbed.id, { title: 'Hidden private bill', private: true });
      const model = modelOf(merging('electricity_bill'));

      expect(await run(model)).toMatchObject({ applied: 1, reextractions: 2 });
      const [call] = model.calls;
      expect(call?.prompt).toContain('<<<UNTRUSTED-DATA');
      expect(call?.prompt).toContain('Public synthetic bill');
      expect(call?.prompt).not.toContain('Hidden private bill');
      expect(await typeOf(db(), absorbed.id)).toMatchObject({ status: 'merged' });
      expect(await documentOf(db(), document)).toMatchObject({
        typeId: kept.id,
        fields: { meter_id: 'PDL-9' },
      });
      expect(await changesOf(db(), 'merge')).toMatchObject([
        { status: 'applied', auto: true, note: 'Applied automatically (auto_apply safe).' },
      ]);
    });

    it('leaves the merge pending with auto_apply none', async () => {
      const { absorbed } = await twins();
      expect(await run(modelOf(merging('electricity_bill')), 'none')).toMatchObject({
        applied: 0,
      });
      expect(await typeOf(db(), absorbed.id)).toMatchObject({ status: 'provisional' });
      expect(await changesOf(db(), 'merge')).toMatchObject([{ status: 'pending', auto: true }]);
    });

    it('waits for approval of a merge that involves a stable type', async () => {
      const { absorbed } = await twins('stable');
      await run(modelOf(merging('electricity_bill')));
      expect(await typeOf(db(), absorbed.id)).toMatchObject({ status: 'stable' });
      expect(await changesOf(db(), 'merge')).toMatchObject([{ status: 'pending', auto: false }]);
    });

    it('waits for approval of a merge the model is not sure enough of', async () => {
      await twins();
      await run(modelOf(merging('electricity_bill', 0.8)));
      expect(await changesOf(db(), 'merge')).toMatchObject([{ status: 'pending', auto: false }]);
    });

    it('records a pair judged distinct and never asks about it again', async () => {
      await twins();
      const model = modelOf({
        merge: () => ({
          decision: 'distinct',
          target: 'electricity_bill',
          field_mapping: [],
          confidence: 0.9,
          rationale: 'Different suppliers file different things.',
        }),
      });
      await run(model);
      await run(model);
      expect(model.calls).toHaveLength(1);
      expect(await changesOf(db(), 'merge')).toMatchObject([{ status: 'rejected' }]);
    });

    it('skips a pair whose answer is not in the schema, and asks again at the next run', async () => {
      await twins();
      const model = modelOf({ merge: () => ({ decision: 'maybe' }) });
      expect(await run(model)).toMatchObject({ proposed: 0 });
      await run(model);
      expect(model.calls).toHaveLength(2);
      expect(await changesOf(db(), 'merge')).toEqual([]);
    });
  });

  it('promotes a key most documents carry in extra, its variants included', async () => {
    const type = await seedType(db(), { slug: 'phone_bill' });
    const documents = await Promise.all(
      ['C-1', 'C-2', 'C-3'].map((value, index) =>
        seedDocument(db(), type.id, {
          extra: index === 2 ? { customer_number: value } : { customer_no: value },
        }),
      ),
    );
    await seedDocument(db(), type.id, { extra: { customer_no: 'C-4' } });
    // The most recent document is private: its value is never a sample shown to the model.
    await seedDocument(db(), type.id, { extra: { customer_no: 'C-PRIVATE-9' }, private: true });
    const model = modelOf({
      promote: () => ({
        promotions: [
          {
            key: 'customer_no',
            name: 'customer_number',
            definition: { type: 'text' },
            variants: ['customer_number', 'not_a_key'],
            rationale: 'Every bill names the customer.',
          },
        ],
      }),
    });

    // Five documents also make the type stable.
    expect(await run(model)).toMatchObject({ applied: 2, reextractions: 5 });
    expect(model.calls[0]?.prompt).toContain('<<<UNTRUSTED-DATA');
    expect(model.calls[0]?.prompt).toContain('C-4');
    expect(model.calls[0]?.prompt).not.toContain('C-PRIVATE-9');
    expect(await typeOf(db(), type.id)).toMatchObject({
      fields: { customer_number: { type: 'text' } },
    });
    expect(await changesOf(db(), 'promote_field')).toMatchObject([
      { payload: { variants: ['customer_no', 'customer_number'], retype: false }, auto: true },
    ]);
    for (const id of documents) {
      expect((await documentOf(db(), id)).extra).toEqual({});
    }
    expect(await queuedReextractions(db())).toHaveLength(5);
  });

  it('never applies a retyping alone with auto_apply safe', async () => {
    const type = await seedType(db(), { slug: 'tax_notice', fields: { year: { type: 'text' } } });
    for (const year of [2024, 2025, 2026]) {
      await seedDocument(db(), type.id, { extra: { tax_year: year } });
    }
    const model = modelOf({
      promote: () => ({
        promotions: [
          {
            key: 'tax_year',
            name: 'year',
            definition: { type: 'number' },
            variants: [],
            rationale: 'The year is a number.',
          },
        ],
      }),
    });
    expect(await run(model)).toMatchObject({ applied: 0 });
    expect(await changesOf(db(), 'promote_field')).toMatchObject([
      { status: 'pending', auto: false, payload: { field: 'year', retype: true } },
    ]);
    expect(await typeOf(db(), type.id)).toMatchObject({ fields: { year: { type: 'text' } } });
  });

  it('reads again whether a change is safe when it is applied', async () => {
    const { kept, absorbed } = await twins();
    await seedChange(
      db(),
      'merge',
      {
        source_id: absorbed.id,
        target_id: kept.id,
        field_mapping: { meter: 'meter_id' },
        confidence: 0.95,
      },
      true,
    );
    // Marked safe for two provisional types; the target became stable since.
    await db().update(docTypes).set({ status: 'stable' }).where(eq(docTypes.id, kept.id));
    expect(await run(modelOf({}))).toMatchObject({ applied: 0 });
    expect(await typeOf(db(), absorbed.id)).toMatchObject({ status: 'provisional' });
    expect(await changesOf(db(), 'merge')).toMatchObject([{ status: 'pending', auto: false }]);
  });

  it('stabilizes a provisional type with five documents and no open merge', async () => {
    const type = await seedType(db(), { slug: 'payslip' });
    for (let index = 0; index < 5; index += 1) await seedDocument(db(), type.id);
    const short = await seedType(db(), { slug: 'rent_receipt' });
    for (let index = 0; index < 4; index += 1) await seedDocument(db(), short.id);

    await run(modelOf({}));
    expect(await typeOf(db(), type.id)).toMatchObject({ status: 'stable' });
    expect(await typeOf(db(), short.id)).toMatchObject({ status: 'provisional' });
  });

  it('does not stabilize a type with an open merge proposal', async () => {
    const { kept } = await twins();
    for (let index = 0; index < 5; index += 1) await seedDocument(db(), kept.id);
    await run(modelOf(merging('electricity_bill', 0.5)));
    expect(await changesOf(db(), 'stabilize')).toEqual([]);
    expect(await typeOf(db(), kept.id)).toMatchObject({ status: 'provisional' });
  });

  it('proposes the removal of a field few documents of a large stable type fill', async () => {
    const type = await seedType(db(), {
      slug: 'bank_statement',
      fields: { account: { type: 'identifier' }, branch: { type: 'text' } },
      status: 'stable',
    });
    for (let index = 0; index < 20; index += 1) {
      await seedDocument(db(), type.id, {
        fields: index === 0 ? { account: 'A', branch: 'B' } : { account: 'A' },
      });
    }
    await run(modelOf({}));
    expect(await changesOf(db(), 'remove_field')).toMatchObject([
      { status: 'pending', auto: false, payload: { type_id: type.id, field: 'branch' } },
    ]);
    expect(await typeOf(db(), type.id)).toMatchObject({ fields: { branch: { type: 'text' } } });

    await run(modelOf({}), 'all');
    expect(await typeOf(db(), type.id)).toMatchObject({ fields: { account: {} } });
    expect(await changesOf(db(), 'remove_field')).toMatchObject([{ status: 'applied' }]);
  });

  it('merges two entities that share a company id, and leaves a name alone for approval', async () => {
    await seedEntity(db(), {
      name: 'Synthetic Grid',
      identifiers: [{ type: 'company_id', value: '999990077' }],
    });
    await seedEntity(db(), {
      name: 'Synthetic Grid Services',
      identifiers: [{ type: 'company_id', value: '999990077' }],
    });
    await seedEntity(db(), { name: 'Synthetic Water' });
    await seedEntity(db(), { name: 'SYNTHETIC WATER' });

    await run(modelOf({}));
    expect(await changesOf(db(), 'merge_entity')).toMatchObject([
      { status: 'applied', auto: true },
      { status: 'pending', auto: false },
    ]);
    expect(await db().$count(entities)).toBe(3);
  });
});
