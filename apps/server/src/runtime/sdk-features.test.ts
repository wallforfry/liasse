import { documents, typeChanges } from '@liasse/core/db';
import { buildSyntheticPdf, waitUntil } from '@liasse/core/testing';
import { createLiasseClient, LiasseApiError, type LiasseClient } from '@liasse/sdk';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { LETTER } from '../synthetic-documents.fixture.ts';
import type { Runtime } from './create-runtime.ts';
import { useRuntimeHarness } from './runtime.test-helper.ts';

const YEAR_2027 = { from: '2027-01-01', to: '2027-12-31' } as const;

// The SDK against a runtime whose pipeline and knowledge layer are bound, with fake models.
describe('the TypeScript SDK on the bound features', () => {
  const { start, database, apiKey } = useRuntimeHarness();

  const clientOf = async (runtime: Runtime): Promise<LiasseClient> =>
    createLiasseClient({
      baseUrl: `http://127.0.0.1:${String(runtime.port)}`,
      token: await apiKey(runtime),
    });

  it('reads subjects and key dates, and corrects a document', async () => {
    const client = await clientOf(await start());
    const file = new File([buildSyntheticPdf([{ lines: [...LETTER.lines] }])], 'letter.pdf');
    const { id } = await client.uploadDocument({ file });
    await waitUntil(async () => (await client.getDocument(id)).status === 'indexed');

    const { subjects, truncated: cut } = await client.listSubjects({ kind: 'contract' });
    expect(cut).toBe(false);
    expect(subjects.map(({ id: _id, ...subject }) => subject)).toEqual([
      { kind: 'contract', name: 'Home insurance contract', aliases: [], document_count: 1 },
    ]);
    const { dates, truncated } = await client.upcoming(YEAR_2027);
    expect(truncated).toBe(false);
    expect(dates.map(({ date, kind, document }) => [date, kind, document.id])).toEqual([
      ['2027-03-15', 'due', id],
    ]);
    expect((await client.upcoming({ ...YEAR_2027, kinds: ['renewal'] })).dates).toEqual([]);

    const corrected = await client.correctDocument(id, { private: true });
    expect(corrected).toMatchObject({ id, private: true, status: 'indexed' });
    expect((await client.upcoming(YEAR_2027)).dates).toEqual([]);

    const refused: unknown = await client
      .correctDocument('doc_unknown', { private: true })
      .catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(LiasseApiError);
    expect(refused).toMatchObject({ status: 404, code: 'document_not_found' });
  });

  it('lists the pending consolidation changes and decides one', async () => {
    const client = await clientOf(await start());
    const file = new File([buildSyntheticPdf([{ lines: [...LETTER.lines] }])], 'letter.pdf');
    const { id } = await client.uploadDocument({ file });
    await waitUntil(async () => (await client.getDocument(id)).status === 'indexed');
    const [document] = await database()
      .db.select({ typeId: documents.typeId })
      .from(documents)
      .where(eq(documents.id, id));
    const [change] = await database()
      .db.insert(typeChanges)
      .values({
        kind: 'stabilize',
        payload: { type_id: document?.typeId ?? '' },
        rationale: 'Synthetic rationale.',
      })
      .returning({ id: typeChanges.id });
    const changeId = change?.id ?? '';

    const { changes } = await client.listChanges({ kind: 'stabilize' });
    expect(changes.map(({ id: listed, status }) => [listed, status])).toEqual([
      [changeId, 'pending'],
    ]);
    const decided = await client.decideChange(changeId, { decision: 'reject', note: 'Too early.' });
    expect(decided).toMatchObject({
      change: { id: changeId, status: 'rejected', note: 'Too early.' },
      documents_to_reextract: 0,
    });
    const again: unknown = await client
      .decideChange(changeId, { decision: 'apply' })
      .catch((error: unknown) => error);
    expect(again).toMatchObject({ status: 400, code: 'change_already_decided' });
    expect((await client.listChanges()).changes).toEqual([]);
  });
});
