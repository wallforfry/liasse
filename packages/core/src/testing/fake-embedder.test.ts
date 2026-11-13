import { describe, expect, it } from 'vitest';
import type { Embedding } from '../models/ports.ts';
import { createFakeEmbedder } from './fake-embedder.ts';

const dot = (left: Embedding, right: Embedding): number =>
  left.reduce((sum, value, index) => sum + value * (right[index] ?? 0), 0);

const embedAll = async (texts: readonly string[], dimension = 384): Promise<readonly Embedding[]> =>
  createFakeEmbedder({ dimension }).embed(texts, 'passage');

const embedOne = async (text: string, dimension = 384): Promise<Embedding> => {
  const [embedding] = await embedAll([text], dimension);
  if (embedding === undefined) throw new Error('no embedding returned');
  return embedding;
};

describe('createFakeEmbedder', () => {
  it('describes itself', () => {
    expect(createFakeEmbedder()).toMatchObject({
      dimension: 384,
      model: 'fake-embedder',
      isLocal: true,
    });
    expect(createFakeEmbedder({ dimension: 16, isLocal: false })).toMatchObject({
      dimension: 16,
      isLocal: false,
    });
  });

  it('returns one L2-normalized vector of the requested dimension per text', async () => {
    const embeddings = await embedAll(['energy bill from EDF', 'payslip for March'], 64);
    expect(embeddings).toHaveLength(2);
    embeddings.forEach((embedding) => {
      expect(embedding).toHaveLength(64);
      expect(dot(embedding, embedding)).toBeCloseTo(1, 10);
    });
  });

  it('is deterministic', async () => {
    expect(await embedOne('home insurance contract')).toEqual(
      await embedOne('home insurance contract'),
    );
  });

  it('embeds queries and passages in the same space', async () => {
    const embedder = createFakeEmbedder();
    expect(await embedder.embed(['electricity bill'], 'query')).toEqual(
      await embedder.embed(['electricity bill'], 'passage'),
    );
  });

  it('ignores case, accents and punctuation', async () => {
    expect(await embedOne('Facture d’électricité !')).toEqual(
      await embedOne('facture d electricite'),
    );
  });

  it('scores similar texts above unrelated ones', async () => {
    const reference = await embedOne('electricity bill for the Lyon apartment');
    const similar = await embedOne('electricity bill for the Paris apartment');
    const unrelated = await embedOne('employment contract signed with a bakery');
    expect(dot(reference, similar)).toBeGreaterThan(0.6);
    expect(dot(reference, similar)).toBeGreaterThan(dot(reference, unrelated) + 0.3);
  });

  it('returns a unit vector for a text without tokens', async () => {
    const embedding = await embedOne('  ...  ');
    expect(dot(embedding, embedding)).toBeCloseTo(1, 10);
  });
});
