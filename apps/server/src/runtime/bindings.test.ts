import { loadConfig } from '@liasse/core/config';
import { ENTITY_ARBITRATION_CANDIDATES } from '@liasse/core/domain';
import { SYNTHETIC_ENV } from '@liasse/core/testing';
import { describe, expect, it } from 'vitest';
import { pipelineSettingsOf } from './bindings.ts';

describe('pipelineSettingsOf', () => {
  it('hands the configured entity similarity thresholds to the pipeline', () => {
    const { pipeline } = loadConfig({
      ...SYNTHETIC_ENV,
      ENTITY_ATTACH_SIMILARITY: '0.97',
      ENTITY_ARBITRATION_SIMILARITY: '0.9',
    });
    expect(pipelineSettingsOf(pipeline).entitySimilarity).toEqual({
      attach: 0.97,
      arbitrate: 0.9,
      candidates: ENTITY_ARBITRATION_CANDIDATES,
    });
  });
});
