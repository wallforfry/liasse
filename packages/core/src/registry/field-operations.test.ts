import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { documents } from '../db/schema/documents.ts';
import { jobs } from '../db/schema/jobs.ts';
import { docTypes, typeChanges } from '../db/schema/registry.ts';
import { MAX_FIELDS_PER_TYPE } from '../domain/limits.ts';
import { createFakeEmbedder } from '../testing/fake-embedder.ts';
import { insertSyntheticDocument } from '../testing/fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import type { RegistryContext } from './context.ts';
import { createType } from './create-type.ts';
import { addField, removeField, renameField, retypeField } from './field-operations.ts';
import { markMerged } from './lifecycle.ts';
import { FIELD_ANNOTATION, parseTypeSchema } from './stored-schema.ts';
import type { RegisteredType } from './type-store.ts';

const BASE_FIELDS = {
  meter_id: { type: 'identifier', format: 'PDL' },
  consumption_kwh: { type: 'number' },
};

describe('field operations', () => {
  let database: TestDatabase;
  let context: RegistryContext;

  const newType = async (slug: string, fields: unknown = BASE_FIELDS): Promise<RegisteredType> => {
    const created = await createType({ slug, description: `Synthetic ${slug}`, fields }, context);
    if (!created.ok) throw new Error(created.error.message);
    return created.value;
  };

  const stored = async (id: string) => {
    const [row] = await database.db.select().from(docTypes).where(eq(docTypes.id, id));
    return row;
  };

  const storedFieldNames = async (id: string) =>
    Object.keys(parseTypeSchema((await stored(id))?.schema)).toSorted();

  const storedDocument = async (id: string) => {
    const [row] = await database.db.select().from(documents).where(eq(documents.id, id));
    return row;
  };

  beforeAll(async () => {
    database = await createTestDatabase();
    context = { db: database.db, embedder: createFakeEmbedder(), maxNewTypesPerDay: 1000 };
  });

  afterAll(async () => {
    await database.dispose();
  });

  describe('addField', () => {
    it('adds the field and bumps the version without touching documents', async () => {
      const type = await newType('add_field');
      const document = await insertSyntheticDocument(database.db, {
        typeId: type.id,
        schemaVersion: 1,
        fields: { consumption_kwh: 312 },
      });
      const result = await addField(type.id, 'supply_address', { type: 'text' }, context);
      expect(result).toMatchObject({
        ok: true,
        value: { version: 2, fields: { ...BASE_FIELDS, supply_address: { type: 'text' } } },
      });
      expect(await stored(type.id)).toMatchObject({
        version: 2,
        schema: {
          properties: { supply_address: { type: 'string', [FIELD_ANNOTATION]: { type: 'text' } } },
        },
      });
      expect(await storedDocument(document.id)).toEqual(document);
    });

    it('rejects a name that already exists, as a name or a primitive conflict', async () => {
      const type = await newType('add_conflict');
      expect(
        await addField(type.id, 'meter_id', { type: 'identifier', format: 'PDL' }, context),
      ).toMatchObject({ ok: false, error: { code: 'field_exists', field: 'meter_id' } });
      expect(await addField(type.id, 'meter_id', { type: 'text' }, context)).toMatchObject({
        ok: false,
        error: {
          code: 'primitive_conflict',
          field: 'meter_id',
          existing: { type: 'identifier', format: 'PDL' },
          proposed: { type: 'text' },
        },
      });
      expect(await stored(type.id)).toMatchObject({ version: 1 });
    });

    it('rejects an invalid name or definition', async () => {
      const type = await newType('add_invalid');
      const rules = async (name: string, definition: unknown) => {
        const result = await addField(type.id, name, definition, context);
        return result.ok || result.error.code !== 'invalid_fields'
          ? []
          : result.error.issues.map(({ rule }) => rule);
      };
      expect(await rules('issuer', { type: 'entity' })).toEqual(['reserved']);
      expect(await rules('SupplyAddress', { type: 'text' })).toEqual(['snake_case']);
      expect(await rules('notes', { type: 'object' })).toEqual(['invalid_definition']);
      expect(await stored(type.id)).toMatchObject({ version: 1 });
    });

    it(`rejects the field that would exceed ${String(MAX_FIELDS_PER_TYPE)}`, async () => {
      const full = Object.fromEntries(
        Array.from({ length: MAX_FIELDS_PER_TYPE }, (_, index) => [
          `field_${String(index)}`,
          { type: 'text' },
        ]),
      );
      const type = await newType('add_full', full);
      expect(await addField(type.id, 'one_too_many', { type: 'text' }, context)).toMatchObject({
        ok: false,
        error: { code: 'invalid_fields', issues: [{ rule: 'too_many_fields' }] },
      });
      expect(await stored(type.id)).toMatchObject({ version: 1 });
    });

    it('gives each of two concurrent additions its own version', async () => {
      const type = await newType('add_concurrent');
      const results = await Promise.all(
        ['first_note', 'second_note', 'third_note'].map((name) =>
          addField(type.id, name, { type: 'text' }, context),
        ),
      );
      expect(
        results.flatMap((result) => (result.ok ? [result.value.version] : [])).toSorted(),
      ).toEqual([2, 3, 4]);
      expect(await storedFieldNames(type.id)).toEqual([
        'consumption_kwh',
        'first_note',
        'meter_id',
        'second_note',
        'third_note',
      ]);
    });
  });

  describe('renameField', () => {
    it('renames the field, keeps its definition and bumps the version', async () => {
      const type = await newType('rename_field');
      expect(await renameField(type.id, 'meter_id', 'delivery_point', context)).toMatchObject({
        ok: true,
        value: {
          version: 2,
          fields: {
            delivery_point: { type: 'identifier', format: 'PDL' },
            consumption_kwh: { type: 'number' },
          },
        },
      });
      expect(await storedFieldNames(type.id)).toEqual(['consumption_kwh', 'delivery_point']);
    });

    it('rejects an unknown source, a taken target and an invalid target', async () => {
      const type = await newType('rename_invalid');
      expect(await renameField(type.id, 'missing', 'anything', context)).toMatchObject({
        ok: false,
        error: { code: 'field_not_found', field: 'missing' },
      });
      expect(await renameField(type.id, 'meter_id', 'consumption_kwh', context)).toMatchObject({
        ok: false,
        error: { code: 'field_exists', field: 'consumption_kwh' },
      });
      expect(await renameField(type.id, 'meter_id', 'amount', context)).toMatchObject({
        ok: false,
        error: { code: 'invalid_fields', issues: [{ field: 'amount', rule: 'reserved' }] },
      });
      expect(await renameField(type.id, 'meter_id', 'Meter ID', context)).toMatchObject({
        ok: false,
        error: { code: 'invalid_fields', issues: [{ rule: 'snake_case' }] },
      });
      expect(await stored(type.id)).toMatchObject({ version: 1 });
    });
  });

  describe('retypeField', () => {
    it('replaces the definition and bumps the version', async () => {
      const type = await newType('retype_field');
      expect(
        await retypeField(type.id, 'consumption_kwh', { type: 'text' }, context),
      ).toMatchObject({
        ok: true,
        value: { version: 2, fields: { ...BASE_FIELDS, consumption_kwh: { type: 'text' } } },
      });
    });

    it('rejects an unknown field, an invalid definition and an unchanged one', async () => {
      const type = await newType('retype_invalid');
      expect(await retypeField(type.id, 'missing', { type: 'text' }, context)).toMatchObject({
        ok: false,
        error: { code: 'field_not_found' },
      });
      expect(await retypeField(type.id, 'meter_id', { type: 'object' }, context)).toMatchObject({
        ok: false,
        error: { code: 'invalid_fields', issues: [{ rule: 'invalid_definition' }] },
      });
      expect(
        await retypeField(type.id, 'meter_id', { type: 'identifier', format: 'PDL' }, context),
      ).toMatchObject({ ok: false, error: { code: 'field_unchanged', field: 'meter_id' } });
      expect(await stored(type.id)).toMatchObject({ version: 1 });
    });
  });

  describe('removeField', () => {
    it('removes the field and bumps the version', async () => {
      const type = await newType('remove_field');
      expect(await removeField(type.id, 'meter_id', context)).toEqual({
        ok: true,
        value: { ...type, version: 2, fields: { consumption_kwh: { type: 'number' } } },
      });
    });

    it('rejects an unknown field', async () => {
      const type = await newType('remove_invalid');
      expect(await removeField(type.id, 'missing', context)).toMatchObject({
        ok: false,
        error: { code: 'field_not_found', field: 'missing' },
      });
      expect(await stored(type.id)).toMatchObject({ version: 1 });
    });
  });

  describe('names that every object inherits', () => {
    const codeOf = async (operation: Promise<{ ok: boolean; error?: { code: string } }>) =>
      (await operation).error?.code ?? 'ok';

    it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf'])(
      'does not find %s on a type that does not define it',
      async (name) => {
        const type = await newType(`absent_${name.toLowerCase().replaceAll('_', '')}`);
        expect(await codeOf(removeField(type.id, name, context))).toBe('field_not_found');
        expect(await codeOf(retypeField(type.id, name, { type: 'text' }, context))).toBe(
          'field_not_found',
        );
        expect(await codeOf(renameField(type.id, name, 'renamed_field', context))).toBe(
          'field_not_found',
        );
        expect(await stored(type.id)).toMatchObject({ version: 1 });
        expect(await storedFieldNames(type.id)).toEqual(['consumption_kwh', 'meter_id']);
      },
    );

    it.each(['toString', '__proto__', 'hasOwnProperty', 'valueOf'])(
      'refuses %s as a new name because it is not snake_case',
      async (name) => {
        const type = await newType(`refused_${name.toLowerCase().replaceAll('_', '')}`);
        expect(await codeOf(addField(type.id, name, { type: 'text' }, context))).toBe(
          'invalid_fields',
        );
        expect(await codeOf(renameField(type.id, 'meter_id', name, context))).toBe(
          'invalid_fields',
        );
        expect(await stored(type.id)).toMatchObject({ version: 1 });
      },
    );

    it('handles constructor, a valid snake_case name, like any other field', async () => {
      const type = await newType('ordinary_constructor');
      expect(await codeOf(addField(type.id, 'constructor', { type: 'text' }, context))).toBe('ok');
      expect(await storedFieldNames(type.id)).toEqual([
        'constructor',
        'consumption_kwh',
        'meter_id',
      ]);
      expect(await codeOf(addField(type.id, 'constructor', { type: 'text' }, context))).toBe(
        'field_exists',
      );
      expect(await codeOf(addField(type.id, 'constructor', { type: 'number' }, context))).toBe(
        'primitive_conflict',
      );
      expect(await codeOf(renameField(type.id, 'meter_id', 'constructor', context))).toBe(
        'field_exists',
      );
      expect(await codeOf(retypeField(type.id, 'constructor', { type: 'number' }, context))).toBe(
        'ok',
      );
      expect(await codeOf(renameField(type.id, 'constructor', 'builder', context))).toBe('ok');
      expect(await codeOf(renameField(type.id, 'meter_id', 'constructor', context))).toBe('ok');
      expect(await codeOf(removeField(type.id, 'constructor', context))).toBe('ok');
      expect(await storedFieldNames(type.id)).toEqual(['builder', 'consumption_kwh']);
      expect(await stored(type.id)).toMatchObject({ version: 6 });
    });
  });

  it('rejects every operation on an unknown type and on a merged type', async () => {
    const source = await newType('merged_source');
    const target = await newType('merged_target');
    await markMerged(source.id, target.id, context);
    const operations = (id: string) => [
      addField(id, 'new_field', { type: 'text' }, context),
      renameField(id, 'meter_id', 'delivery_point', context),
      retypeField(id, 'meter_id', { type: 'text' }, context),
      removeField(id, 'meter_id', context),
    ];
    const codes = async (id: string) =>
      (await Promise.all(operations(id))).map((result) => (result.ok ? 'ok' : result.error.code));
    expect(await codes('typ_unknown')).toEqual(Array.from({ length: 4 }, () => 'type_not_found'));
    expect(await codes(source.id)).toEqual(Array.from({ length: 4 }, () => 'type_merged'));
    expect(await stored(source.id)).toMatchObject({ version: 1 });
  });

  it('records no type_changes row and queues no job', async () => {
    const type = await newType('pure_writes');
    await addField(type.id, 'note', { type: 'text' }, context);
    await renameField(type.id, 'note', 'remark', context);
    await retypeField(type.id, 'remark', { type: 'number' }, context);
    await removeField(type.id, 'remark', context);
    expect(await stored(type.id)).toMatchObject({ version: 5 });
    expect(await database.db.$count(typeChanges)).toBe(0);
    expect(await database.db.$count(jobs)).toBe(0);
  });
});
