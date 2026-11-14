import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chunks, documentPages, documents } from '../db/schema/documents.ts';
import { docTypes } from '../db/schema/registry.ts';
import type { Embedder, EmbeddingKind } from '../models/ports.ts';
import { createFakeEmbedder } from '../testing/fake-embedder.ts';
import { insertSyntheticDocument, type NewDocumentRow } from '../testing/fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import { DocumentNotFoundError, indexDocument } from './indexing.ts';

interface EmbedCall {
  readonly texts: readonly string[];
  readonly kind: EmbeddingKind;
}

const recording = (embedder: Embedder) => {
  const calls: EmbedCall[] = [];
  const recorder: Embedder = {
    ...embedder,
    embed: (texts, kind) => {
      calls.push({ texts, kind });
      return embedder.embed(texts, kind);
    },
  };
  return { embedder: recorder, calls };
};

const failing = (message: string): Embedder => ({
  ...createFakeEmbedder(),
  embed: () => Promise.reject(new Error(message)),
});

describe('indexDocument', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database.dispose();
  });

  const documentWithPages = async (
    pages: readonly string[],
    overrides: Partial<NewDocumentRow> = {},
  ): Promise<string> => {
    const { id } = await insertSyntheticDocument(database.db, overrides);
    if (pages.length > 0) {
      await database.db
        .insert(documentPages)
        .values(pages.map((text, index) => ({ documentId: id, page: index + 1, text })));
    }
    return id;
  };

  const storedChunks = (documentId: string) =>
    database.db
      .select()
      .from(chunks)
      .where(eq(chunks.documentId, documentId))
      .orderBy(asc(chunks.pageFrom), asc(chunks.id));

  it('stores one chunk per short page, with its page and the text as written', async () => {
    const id = await documentWithPages(['Total due: 84.20 EUR', 'Meter reading: 4512 kWh']);
    expect(await indexDocument({ db: database.db, embedder: createFakeEmbedder() }, id)).toEqual({
      chunkCount: 2,
      embedded: true,
    });
    expect(await storedChunks(id)).toMatchObject([
      { pageFrom: 1, pageTo: 1, text: 'Total due: 84.20 EUR' },
      { pageFrom: 2, pageTo: 2, text: 'Meter reading: 4512 kWh' },
    ]);
  });

  it('embeds each chunk as a passage, prefixed with the title and the type slug', async () => {
    const [type] = await database.db
      .insert(docTypes)
      .values({ slug: 'energy_bill', description: 'Energy bill' })
      .returning();
    const id = await documentWithPages(['Total due: 84.20 EUR'], {
      title: 'September energy bill',
      typeId: type?.id,
    });
    const { embedder, calls } = recording(createFakeEmbedder());
    await indexDocument({ db: database.db, embedder }, id);
    const input = 'Title: September energy bill\nType: energy_bill\n\nTotal due: 84.20 EUR';
    expect(calls).toEqual([{ texts: [input], kind: 'passage' }]);
    const [expected] = await createFakeEmbedder().embed([input], 'passage');
    const [stored] = await storedChunks(id);
    expect(stored?.text).toBe('Total due: 84.20 EUR');
    expect(stored?.embedding?.map((value) => value.toFixed(5))).toEqual(
      expected?.map((value) => value.toFixed(5)),
    );
  });

  it('embeds in batches of 32 chunks', async () => {
    const pages = Array.from({ length: 70 }, (_, index) => `Page ${String(index + 1)}`);
    const id = await documentWithPages(pages);
    const { embedder, calls } = recording(createFakeEmbedder());
    await indexDocument({ db: database.db, embedder }, id);
    expect(calls.map((call) => call.texts.length)).toEqual([32, 32, 6]);
    expect((await storedChunks(id)).map((chunk) => chunk.text)).toEqual(pages);
  });

  it('gives chunks and pages the language of the document', async () => {
    const id = await documentWithPages(['Les factures impayées'], { core: { language: 'fr' } });
    await indexDocument({ db: database.db, embedder: createFakeEmbedder() }, id);
    expect(await storedChunks(id)).toMatchObject([
      { language: 'fr', tsv: "'factur':2 'impaye':3 'le':1" },
    ]);
    expect(
      await database.db.select().from(documentPages).where(eq(documentPages.documentId, id)),
    ).toMatchObject([{ language: 'fr', tsv: "'factur':2 'impaye':3 'le':1" }]);
  });

  it.each([[{}], [{ language: 'french' }], [{ language: 42 }]])(
    'leaves the language unknown for the core %j',
    async (core) => {
      const id = await documentWithPages(['Les factures impayées'], { core });
      await indexDocument({ db: database.db, embedder: createFakeEmbedder() }, id);
      expect(await storedChunks(id)).toMatchObject([
        { language: null, tsv: "'factures':2 'impayees':3 'les':1" },
      ]);
    },
  );

  it('replaces the chunks when the document is indexed again', async () => {
    const id = await documentWithPages(['First version', 'Second page']);
    const deps = { db: database.db, embedder: createFakeEmbedder() };
    await indexDocument(deps, id);
    const first = await storedChunks(id);
    await indexDocument(deps, id);
    const second = await storedChunks(id);
    expect(second.map(({ id: _id, ...chunk }) => chunk)).toEqual(
      first.map(({ id: _id, ...chunk }) => chunk),
    );
    expect(second.map((chunk) => chunk.id)).not.toEqual(first.map((chunk) => chunk.id));

    await database.db.delete(documentPages).where(eq(documentPages.documentId, id));
    await database.db.insert(documentPages).values({ documentId: id, page: 1, text: 'Rewritten' });
    await indexDocument(deps, id);
    expect((await storedChunks(id)).map((chunk) => chunk.text)).toEqual(['Rewritten']);
  });

  it('removes the chunks of a document that has no text left', async () => {
    const id = await documentWithPages(['Soon gone']);
    const { embedder, calls } = recording(createFakeEmbedder());
    await indexDocument({ db: database.db, embedder }, id);
    await database.db.delete(documentPages).where(eq(documentPages.documentId, id));
    expect(await indexDocument({ db: database.db, embedder }, id)).toEqual({
      chunkCount: 0,
      embedded: true,
    });
    expect(await storedChunks(id)).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it('keeps the previous chunks when the embedder fails', async () => {
    const id = await documentWithPages(['Indexed once']);
    await indexDocument({ db: database.db, embedder: createFakeEmbedder() }, id);
    const before = await storedChunks(id);
    await database.db
      .update(documentPages)
      .set({ text: 'Changed text' })
      .where(eq(documentPages.documentId, id));
    await expect(
      indexDocument({ db: database.db, embedder: failing('synthetic embedder outage') }, id),
    ).rejects.toThrow('synthetic embedder outage');
    expect(await storedChunks(id)).toEqual(before);
  });

  it('keeps the previous chunks when the new ones cannot be stored', async () => {
    const id = await documentWithPages(['Indexed once']);
    await indexDocument({ db: database.db, embedder: createFakeEmbedder() }, id);
    const before = await storedChunks(id);
    const wrongDimension = createFakeEmbedder({ dimension: 8 });
    await expect(
      indexDocument({ db: database.db, embedder: wrongDimension }, id),
    ).rejects.toThrow();
    expect(await storedChunks(id)).toEqual(before);
  });

  describe('with an embedder that reads a bounded number of tokens', () => {
    const WINDOW = 60;
    const words = (text: string): number => text.split(/\s+/u).filter((word) => word !== '').length;

    // One token per word, or per character for text without spaces, as CJK text is.
    const windowed = (count: (text: string) => number) => {
      const inputs: string[] = [];
      const embedder: Embedder = {
        ...createFakeEmbedder(),
        maxInputTokens: WINDOW,
        countTokens: (texts) => Promise.resolve(texts.map(count)),
        embed: (texts, kind) => {
          inputs.push(...texts);
          return createFakeEmbedder().embed(texts, kind);
        },
      };
      return { embedder, inputs };
    };

    it('sizes the chunks so that the model reads every word of the page', async () => {
      const page = Array.from({ length: 700 }, (_, index) => `mot${String(index)}`);
      const id = await documentWithPages([page.join(' ')], { title: 'Bail d’habitation' });
      const { embedder, inputs } = windowed(words);
      await indexDocument({ db: database.db, embedder }, id);
      expect(inputs.length).toBeGreaterThan(12);
      expect(Math.max(...inputs.map(words))).toBeLessThanOrEqual(WINDOW);
      const stored = (await storedChunks(id)).flatMap((chunk) => chunk.text.split(' '));
      expect([...new Set(stored)]).toEqual(page);
    });

    it('does the same for a text without spaces, one token per character', async () => {
      const page = Array.from({ length: 900 }, (_, index) =>
        String.fromCodePoint(0x4e_00 + index),
      ).join('');
      const id = await documentWithPages([page]);
      const { embedder, inputs } = windowed((text) => Array.from(text).length);
      await indexDocument({ db: database.db, embedder }, id);
      expect(Math.max(...inputs.map((input) => Array.from(input).length))).toBeLessThanOrEqual(
        WINDOW,
      );
      const stored = (await storedChunks(id)).map((chunk) => chunk.text);
      expect(stored.every((chunk) => page.includes(chunk))).toBe(true);
      const covered = new Set(
        stored.flatMap((chunk) => Array.from(chunk, (_, at) => page.indexOf(chunk) + at)),
      );
      expect(covered.size).toBe(page.length);
    });

    it('keeps 800 tokens for an embedder that states no window', async () => {
      const id = await documentWithPages([Array.from({ length: 2000 }, () => 'mot').join(' ')]);
      const inputs: string[] = [];
      const embedder: Embedder = {
        ...createFakeEmbedder(),
        countTokens: (texts) => Promise.resolve(texts.map(words)),
        embed: (texts, kind) => {
          inputs.push(...texts);
          return createFakeEmbedder().embed(texts, kind);
        },
      };
      await indexDocument({ db: database.db, embedder }, id);
      expect(Math.max(...inputs.map(words))).toBe(800);
    });
  });

  it('never sends a private document to an embedder that is not local', async () => {
    const id = await documentWithPages(['Avis d’imposition confidentiel'], { private: true });
    const { embedder, calls } = recording(createFakeEmbedder({ isLocal: false }));
    expect(await indexDocument({ db: database.db, embedder }, id)).toEqual({
      chunkCount: 1,
      embedded: false,
    });
    expect(calls).toEqual([]);
    expect(await storedChunks(id)).toMatchObject([
      {
        text: 'Avis d’imposition confidentiel',
        embedding: null,
        tsv: "'avis':1 'confidentiel':4 'd':2 'imposition':3",
      },
    ]);
  });

  it.each([
    { private: true, isLocal: true },
    { private: false, isLocal: false },
    { private: false, isLocal: true },
  ])(
    'embeds when the document and the embedder are %j',
    async ({ private: isPrivate, isLocal }) => {
      const id = await documentWithPages(['Total due'], { private: isPrivate });
      const { embedder, calls } = recording(createFakeEmbedder({ isLocal }));
      expect(await indexDocument({ db: database.db, embedder }, id)).toMatchObject({
        embedded: true,
      });
      expect(calls).toHaveLength(1);
      expect((await storedChunks(id))[0]?.embedding).toHaveLength(384);
    },
  );

  it('drops the embeddings of a document that became private, on the next indexing', async () => {
    const id = await documentWithPages(['Total due']);
    const embedder = createFakeEmbedder({ isLocal: false });
    await indexDocument({ db: database.db, embedder }, id);
    await database.db.update(documents).set({ private: true }).where(eq(documents.id, id));
    await indexDocument({ db: database.db, embedder }, id);
    expect((await storedChunks(id)).map((chunk) => chunk.embedding)).toEqual([null]);
  });

  it('does not ask a remote embedder to count the tokens of a private document', async () => {
    const id = await documentWithPages(['Avis d’imposition confidentiel'], { private: true });
    const embedder: Embedder = {
      ...createFakeEmbedder({ isLocal: false }),
      maxInputTokens: 60,
      countTokens: () => Promise.reject(new Error('the document must not leave the server')),
    };
    expect(await indexDocument({ db: database.db, embedder }, id)).toEqual({
      chunkCount: 1,
      embedded: false,
    });
  });

  it('rejects an unknown document', async () => {
    const failure = indexDocument(
      { db: database.db, embedder: createFakeEmbedder() },
      'doc_missing',
    );
    await expect(failure).rejects.toBeInstanceOf(DocumentNotFoundError);
    await expect(failure).rejects.toThrow('Document doc_missing does not exist');
  });

  it('serialises two concurrent runs for the same document', async () => {
    const id = await documentWithPages(['One', 'Two', 'Three']);
    const deps = { db: database.db, embedder: createFakeEmbedder() };
    await Promise.all(Array.from({ length: 6 }, () => indexDocument(deps, id)));
    expect((await storedChunks(id)).map((chunk) => chunk.text)).toEqual(['One', 'Two', 'Three']);
  });

  it('rejects an embedder that does not return one embedding per chunk', async () => {
    const id = await documentWithPages(['One', 'Two']);
    const short: Embedder = {
      ...createFakeEmbedder(),
      embed: (texts) => createFakeEmbedder().embed(texts.slice(1), 'passage'),
    };
    await expect(indexDocument({ db: database.db, embedder: short }, id)).rejects.toThrow(
      'returned 1 embeddings for 2 chunks',
    );
  });
});
