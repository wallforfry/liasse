import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { documentPages } from '../db/schema/documents.ts';
import { MANUAL_PROVENANCE } from '../domain/provenance.ts';
import {
  createPipelineHarness,
  live,
  type PipelineHarness,
  scriptedModel,
} from '../pipeline/harness.test-helper.ts';
import { reextractDocument } from '../pipeline/process-document.ts';
import { decideChange } from './apply-change.ts';
import { seedChange, seedDocument, seedType } from './consolidation.test-helper.ts';

const PAGE = 'Synthetic Telecom\nCustomer number C-777\nTotal 12,00 EUR';
const QUOTED = { page: 1, quote: 'Customer number C-777', confidence: 0.9 };

describe('a manual correction through consolidation', () => {
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

  it('survives a promotion and the re-extraction it queues', async () => {
    const type = await seedType(harness.db, { slug: 'phone_bill' });
    const id = await seedDocument(harness.db, type.id, {
      extra: { customer_no: 'C-MANUAL' },
      provenance: { customer_no: MANUAL_PROVENANCE },
      manualFields: ['customer_no'],
    });
    await harness.db.insert(documentPages).values({ documentId: id, page: 1, text: PAGE });
    const change = await seedChange(harness.db, 'promote_field', {
      type_id: type.id,
      field: 'customer_number',
      definition: { type: 'text' },
      variants: ['customer_no'],
      retype: false,
    });
    expect(await decideChange(harness.db, change, 'apply', null)).toMatchObject({
      decided: { change: { status: 'applied' }, reextractions: 1 },
    });

    // The text says otherwise; the person who corrected the value has the last word.
    const reextracting = scriptedModel({
      extract: () => ({
        core: {},
        fields: { customer_number: { value: 'C-777', ...QUOTED } },
        extra: { customer_no: { value: 'C-777', ...QUOTED } },
      }),
    });
    await reextractDocument(harness.deps({ textModel: reextracting }), id, live());
    expect(await harness.document(id)).toMatchObject({
      schemaVersion: 2,
      fields: { customer_number: 'C-MANUAL' },
      provenance: { customer_number: MANUAL_PROVENANCE },
      manualFields: ['customer_number'],
    });
  });
});
