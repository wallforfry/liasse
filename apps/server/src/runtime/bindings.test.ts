import { ENTITY_ARBITRATION_CANDIDATES } from '@liasse/contract/domain';
import { resolvedSyntheticSettings } from '@liasse/core/testing';
import { describe, expect, it } from 'vitest';
import { pipelineSettingsOf } from './bindings.ts';

describe('pipelineSettingsOf', () => {
  it('hands the entity similarity thresholds of the settings to the pipeline', () => {
    const { pipeline } = resolvedSyntheticSettings({
      pipeline: { entity_attach_similarity: 0.97, entity_arbitration_similarity: 0.9 },
    });
    expect(pipelineSettingsOf(pipeline).entitySimilarity).toEqual({
      attach: 0.97,
      arbitrate: 0.9,
      candidates: ENTITY_ARBITRATION_CANDIDATES,
    });
  });
});
