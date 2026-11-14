import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { jobs } from '../db/schema/jobs.ts';
import { docTypes } from '../db/schema/registry.ts';
import { MANUAL_PROVENANCE } from '../domain/provenance.ts';
import { listTypes } from '../registry/read-types.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import { decideChange } from './apply-change.ts';
import {
  documentOf,
  EXTRACTED,
  queuedReextractions,
  seedChange,
  seedDocument,
  seedType,
  typeOf,
} from './consolidation.test-helper.ts';

describe('applying a change to the type registry', () => {
  let database: TestDatabase;
  const db = () => database.db;
  const apply = (id: string) => decideChange(db(), id, 'apply', null);

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterEach(async () => {
    await db().delete(jobs);
  });

  afterAll(async () => {
    await database.dispose();
  });

  describe('a merge', () => {
    it('moves the documents to the target with the registry write, renamed by the mapping', async () => {
      const source = await seedType(db(), {
        slug: 'power_bill',
        fields: { meter: { type: 'identifier' }, kwh: { type: 'number' } },
      });
      const target = await seedType(db(), {
        slug: 'energy_bill',
        fields: { meter_id: { type: 'identifier' }, consumption: { type: 'number' } },
      });
      const manual = await seedDocument(db(), source.id, {
        fields: { meter: 'PDL-1', kwh: 350 },
        provenance: { meter: MANUAL_PROVENANCE, kwh: EXTRACTED },
        manualFields: ['meter'],
      });
      const onItsWay = await seedDocument(db(), source.id, { status: 'classified' });
      const tombstone = await seedDocument(db(), source.id, {
        status: 'deleted',
        fields: { meter: 'GONE' },
      });
      await seedDocument(db(), target.id);
      const change = await seedChange(db(), 'merge', {
        source_id: source.id,
        target_id: target.id,
        field_mapping: { meter: 'meter_id', kwh: 'consumption' },
        confidence: 0.95,
      });

      const result = await apply(change);
      expect(result).toMatchObject({
        outcome: 'decided',
        decided: { change: { status: 'applied' }, reextractions: 1 },
      });
      expect(await documentOf(db(), manual)).toMatchObject({
        typeId: target.id,
        schemaVersion: null,
        confidence: 0.9,
        fields: { meter_id: 'PDL-1', consumption: 350 },
        provenance: { meter_id: MANUAL_PROVENANCE, consumption: EXTRACTED },
        manualFields: ['meter_id'],
      });
      expect(await documentOf(db(), onItsWay)).toMatchObject({ typeId: target.id });
      // A tombstone is not a document: no change moves it.
      expect(await documentOf(db(), tombstone)).toMatchObject({
        typeId: source.id,
        fields: { meter: 'GONE' },
      });
      expect(await queuedReextractions(db())).toEqual([manual]);
      // The count is computed from the documents: it follows them to the target.
      const listed = await listTypes({}, { db: db() });
      expect(listed.find(({ id }) => id === target.id)).toMatchObject({
        docCount: 3,
        aliases: ['power_bill'],
      });
      expect(listed.find(({ id }) => id === source.id)).toBeUndefined();
    });

    it('undoes the moves and rejects the change when the registry refuses the merge', async () => {
      // A source with a child under a target with a parent: three levels.
      await seedType(db(), { slug: 'bill_parent' });
      const source = await seedType(db(), { slug: 'bill_with_child' });
      const child = await seedType(db(), { slug: 'bill_child' });
      const target = await seedType(db(), { slug: 'bill_under_parent' });
      await db().update(docTypes).set({ parentSlug: source.slug }).where(eq(docTypes.id, child.id));
      await db()
        .update(docTypes)
        .set({ parentSlug: 'bill_parent' })
        .where(eq(docTypes.id, target.id));
      const document = await seedDocument(db(), source.id);
      const change = await seedChange(db(), 'merge', {
        source_id: source.id,
        target_id: target.id,
        field_mapping: {},
        confidence: 0.95,
      });

      const result = await apply(change);
      expect(result).toMatchObject({
        outcome: 'decided',
        decided: {
          change: { status: 'rejected' },
          reextractions: 0,
          refusal: { code: 'hierarchy_too_deep' },
        },
      });
      expect(await documentOf(db(), document)).toMatchObject({ typeId: source.id });
      expect(await typeOf(db(), source.id)).toMatchObject({ status: 'provisional' });
      expect(await queuedReextractions(db())).toEqual([]);
    });
  });

  describe('a promotion', () => {
    it('adds the field and makes the variants of extra its values, manual marks included', async () => {
      const type = await seedType(db(), { slug: 'phone_bill' });
      const corrected = await seedDocument(db(), type.id, {
        extra: { customer_no: 'C-1', usage: 3 },
        provenance: { customer_no: MANUAL_PROVENANCE, usage: EXTRACTED },
        manualFields: ['customer_no'],
      });
      const variant = await seedDocument(db(), type.id, {
        extra: { customer_number: 'C-2' },
        provenance: { customer_number: EXTRACTED },
      });
      const change = await seedChange(db(), 'promote_field', {
        type_id: type.id,
        field: 'customer_number',
        definition: { type: 'text' },
        variants: ['customer_no', 'customer_number'],
        retype: false,
      });

      expect(await apply(change)).toMatchObject({ decided: { reextractions: 2 } });
      expect(await typeOf(db(), type.id)).toMatchObject({
        version: 2,
        fields: { customer_number: { type: 'text' } },
      });
      expect(await documentOf(db(), corrected)).toMatchObject({
        fields: { customer_number: 'C-1' },
        extra: { usage: 3 },
        provenance: { customer_number: MANUAL_PROVENANCE, usage: EXTRACTED },
        manualFields: ['customer_number'],
      });
      expect(await documentOf(db(), variant)).toMatchObject({
        fields: { customer_number: 'C-2' },
        extra: {},
      });
    });

    it('refuses to redefine a field without a retyping approved', async () => {
      const type = await seedType(db(), { slug: 'tax_notice', fields: { year: { type: 'text' } } });
      const document = await seedDocument(db(), type.id, { fields: { year: '2026' } });
      const change = await seedChange(db(), 'promote_field', {
        type_id: type.id,
        field: 'year',
        definition: { type: 'number' },
        variants: ['tax_year'],
        retype: false,
      });
      expect(await apply(change)).toMatchObject({
        decided: { change: { status: 'rejected' }, refusal: { code: 'primitive_conflict' } },
      });
      expect(await typeOf(db(), type.id)).toMatchObject({ version: 1 });
      expect(await documentOf(db(), document)).toMatchObject({ fields: { year: '2026' } });
    });
  });

  it('removes a field and keeps its values, manual ones protected, in extra', async () => {
    const type = await seedType(db(), {
      slug: 'water_bill',
      fields: { meter: { type: 'identifier' }, rate: { type: 'text' } },
      status: 'stable',
    });
    const document = await seedDocument(db(), type.id, {
      fields: { meter: 'W-1', rate: 'flat' },
      provenance: { meter: EXTRACTED, rate: MANUAL_PROVENANCE },
      manualFields: ['rate'],
    });
    const change = await seedChange(db(), 'remove_field', { type_id: type.id, field: 'rate' });
    expect(await apply(change)).toMatchObject({ decided: { reextractions: 1 } });
    expect(await typeOf(db(), type.id)).toMatchObject({
      version: 2,
      fields: { meter: { type: 'identifier' } },
    });
    expect(await documentOf(db(), document)).toMatchObject({
      fields: { meter: 'W-1' },
      extra: { rate: 'flat' },
      provenance: { rate: MANUAL_PROVENANCE },
      manualFields: ['rate'],
    });
  });

  it('stabilizes a type without extracting any document again', async () => {
    const type = await seedType(db(), { slug: 'payslip' });
    await seedDocument(db(), type.id);
    const change = await seedChange(db(), 'stabilize', { type_id: type.id });
    expect(await apply(change)).toMatchObject({ decided: { reextractions: 0 } });
    expect(await typeOf(db(), type.id)).toMatchObject({ status: 'stable', version: 1 });
    expect(await queuedReextractions(db())).toEqual([]);
  });
});
