import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { entities } from '../db/schema/registry.ts';
import { redactSensitiveIdentifiers } from '../entities/detect-sensitive.ts';
import { EntityResolutionContendedError } from '../entities/resolve.ts';
import { entitiesOf, maskOf } from './bindings.ts';
import { documentErrorCode, isPermanentFailure } from './errors.ts';
import {
  createPipelineHarness,
  type PipelineHarness,
  SYNTHETIC_IBAN,
} from './harness.test-helper.ts';

describe('the bindings of the pipeline', () => {
  let harness: PipelineHarness;

  beforeAll(async () => {
    harness = await createPipelineHarness();
  });

  afterEach(async () => {
    await harness.reset();
  });

  afterAll(async () => {
    await harness.dispose();
  });

  // The dependencies of the server: nothing injected in place of the real functions.
  const real = (settings = {}) => {
    const { entities: _recording, ...deps } = harness.deps();
    return { ...deps, settings: { ...deps.settings, ...settings } };
  };

  const options = { allowExternalEmbedding: true };

  it('resolves a mention with the real entity resolution, creating then attaching', async () => {
    const resolver = entitiesOf(real());
    const created = await resolver.resolve({ name: 'Synthetic Energy SA', kind: 'org' }, options);
    const attached = await resolver.resolve({ name: 'SYNTHETIC ENERGY' }, options);
    expect(created).toMatchObject({ provenance: { match: 'created' }, droppedIdentifiers: 0 });
    expect(attached?.provenance).toMatchObject({
      entity_id: created?.provenance.entity_id,
      match: 'name',
    });
    expect(await harness.db.select().from(entities)).toHaveLength(1);
  });

  it('answers nothing for a mention the resolver refuses, and creates nothing', async () => {
    const resolver = entitiesOf(real());
    expect(await resolver.resolve({ name: 'x'.repeat(201) }, options)).toBeUndefined();
    expect(await resolver.resolve({ name: '   ' }, options)).toBeUndefined();
    expect(await harness.db.select().from(entities)).toEqual([]);
  });

  it('counts the identifiers the resolver did not keep', async () => {
    const resolved = await entitiesOf(real()).resolve(
      {
        name: 'Synthetic Bank',
        identifiers: [
          { type: 'iban', value: SYNTHETIC_IBAN },
          { type: 'company_id', value: '---' },
        ],
      },
      options,
    );
    expect(resolved?.droppedIdentifiers).toBe(1);
  });

  // The thresholds of the specification were never calibrated on a real embedder.
  it('applies the similarity thresholds of the settings in place of the defaults', async () => {
    const seed = { name: 'Synthetic Energy Group', kind: 'org' } as const;
    const near = { name: 'Synthetic Energy Holding', kind: 'org' } as const;
    const first = await entitiesOf(real()).resolve(seed, options);
    const loose = { entitySimilarity: { attach: 0.5, arbitrate: 0.4, candidates: 3 } };
    const attached = await entitiesOf(real(loose)).resolve(near, options);
    expect(attached?.provenance).toMatchObject({
      entity_id: first?.provenance.entity_id,
      match: 'similarity',
    });
    await harness.reset();
    await entitiesOf(real()).resolve(seed, options);
    const apart = await entitiesOf(real()).resolve(near, options);
    expect(apart?.provenance.match).toBe('created');
  });

  it('prefers what the caller injected', () => {
    const injected = harness.deps({ maskSensitive: (text) => text.toUpperCase() });
    expect(maskOf(injected)('abc')).toBe('ABC');
    expect(entitiesOf(injected)).toBe(injected.entities);
    expect(maskOf(real())).toBe(redactSensitiveIdentifiers);
  });

  it('treats a contended resolution as a conflict another attempt can settle', () => {
    const error = new EntityResolutionContendedError('contended');
    expect(isPermanentFailure(error)).toBe(false);
    expect(documentErrorCode(error)).toBe('processing_conflict');
  });
});
