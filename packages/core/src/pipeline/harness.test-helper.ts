import { eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { chunks, documentPages, documents } from '../db/schema/documents.ts';
import { jobs } from '../db/schema/jobs.ts';
import { documentDates, documentLinks, facts } from '../db/schema/knowledge.ts';
import { docTypes, entities } from '../db/schema/registry.ts';
import type { Transaction } from '../ingest/existing-document.ts';
import { createIngestHarness, type IngestHarness } from '../ingest/harness.test-helper.ts';
import { ingestFile } from '../ingest/ingest-file.ts';
import { createFakeEmbedder } from '../testing/fake-embedder.ts';
import {
  createFakeTextModel,
  type FakeTextModel,
  type FakeTextRequest,
} from '../testing/fake-text-model.ts';
import { createFakeVisionModel } from '../testing/fake-vision-model.ts';
import { syntheticPdf } from '../testing/synthetic-files.ts';
import type { ExtractedText } from '../text/types.ts';
import type { EntityMentionInput, EntityResolver, PipelineDeps } from './deps.ts';
import { createSensitiveMasker } from './sensitive-masker.ts';

// Structurally valid numbers of accounts that do not exist.
export const SYNTHETIC_IBAN = 'DE37 9999 9999 0123 4567 89';
export const SYNTHETIC_IBAN_MASKED = '****6789';

const IBAN = /[A-Z]{2}\d{2}(?: ?[A-Z0-9]){11,30}/g;

const isIban = (candidate: string): boolean => {
  const compact = candidate.replace(/ /g, '');
  const digits = `${compact.slice(4)}${compact.slice(0, 4)}`.replace(/[A-Z]/g, (letter) =>
    String(Number.parseInt(letter, 36)),
  );
  return BigInt(digits) % 97n === 1n;
};

// A stand-in for the detector and the masker of entity resolution: IBANs only.
export const maskSyntheticIbans = createSensitiveMasker(
  (text) =>
    [...text.matchAll(IBAN)]
      .filter(([match]) => isIban(match))
      .map(({ 0: value, index }) => ({ start: index, end: index + value.length, value })),
  ({ value }) => `****${value.replace(/ /g, '').slice(-4)}`,
);

export interface FakeEntities extends EntityResolver {
  readonly mentions: readonly EntityMentionInput[];
  readonly options: readonly { readonly allowExternalEmbedding: boolean }[];
  readonly clear: () => void;
}

// Entities by exact name, in the real table and under a real advisory lock, so the
// ordering contract (lock, then `missingIds`, then write) is exercised for real.
export const createFakeEntities = (db: Database): FakeEntities => {
  const mentions: EntityMentionInput[] = [];
  const options: { readonly allowExternalEmbedding: boolean }[] = [];
  const lock = sql`SELECT pg_advisory_xact_lock(hashtext('liasse.entities'))`;
  return {
    mentions,
    clear: () => {
      mentions.length = 0;
      options.length = 0;
    },
    options,
    resolve: async (mention, option) => {
      mentions.push(mention);
      options.push(option);
      if (mention.name.startsWith('Unresolvable')) return undefined;
      const [known] = await db
        .select({ id: entities.id })
        .from(entities)
        .where(eq(entities.canonicalName, mention.name));
      if (known !== undefined) return { entity_id: known.id, match: 'name', confidence: 0.99 };
      const [created] = await db
        .insert(entities)
        .values({ kind: mention.kind ?? 'org', canonicalName: mention.name })
        .returning({ id: entities.id });
      if (created === undefined) throw new Error('The entity was not created');
      return { entity_id: created.id, match: 'created', confidence: 1 };
    },
    withLock: (executor, work) =>
      executor.transaction(async (tx) => {
        await tx.execute(lock);
        return work(tx);
      }),
    missingIds: async (tx: Transaction, ids) => {
      if (ids.length === 0) return [];
      const found = await tx
        .select({ id: entities.id })
        .from(entities)
        .where(inArray(entities.id, [...ids]));
      return ids.filter((id) => !found.some((entity) => entity.id === id));
    },
  };
};

export const isClassification = ({ system }: FakeTextRequest): boolean =>
  system.startsWith('You file');

export interface ModelScript {
  readonly classify?: (request: FakeTextRequest, call: number) => unknown;
  readonly extract?: (request: FakeTextRequest, call: number) => unknown;
}

export const NEW_TYPE = {
  decision: 'new',
  confidence: 0.9,
  justification: 'No candidate describes an energy bill. The registry is empty.',
  new_type: {
    slug: 'energy_bill',
    description: 'Bill from an electricity or gas supplier',
    parent_slug: null,
    fields: {
      meter_id: { type: 'identifier' },
      parties: { type: 'list', items: { type: 'entity' } },
    },
  },
} as const;

export const scriptedModel = ({ classify, extract }: ModelScript): FakeTextModel => {
  let classifications = 0;
  let extractions = 0;
  return createFakeTextModel((request) => {
    if (isClassification(request)) {
      classifications += 1;
      return (classify ?? (() => NEW_TYPE))(request, classifications);
    }
    extractions += 1;
    return (extract ?? (() => ({ core: {}, fields: {}, extra: {} })))(request, extractions);
  });
};

export const pagesOf = (...texts: readonly string[]): ExtractedText => ({
  pages: texts.map((text, index) => ({ page: index + 1, text, method: 'native' })),
  method: 'native',
  attachments: [],
});

export interface PipelineHarness {
  readonly ingestHarness: IngestHarness;
  readonly db: Database;
  readonly entities: FakeEntities;
  readonly indexed: readonly string[];
  /** Dependencies with fakes for everything but the database and the storage. */
  readonly deps: (overrides?: Partial<PipelineDeps>) => PipelineDeps;
  /** Ingests synthetic bytes; the text of the document is whatever `extractText` answers. */
  readonly ingest: (label: string, hint?: string) => Promise<string>;
  readonly document: (id: string) => Promise<typeof documents.$inferSelect>;
  readonly reset: () => Promise<void>;
  readonly dispose: () => Promise<void>;
}

export const DEFAULT_TEXT = pagesOf('Synthetic Energy SA\nInvoice SYN-2026-001\nTotal 84,20 EUR');

export const createPipelineHarness = async (): Promise<PipelineHarness> => {
  const ingestHarness = await createIngestHarness();
  const { db } = ingestHarness.database;
  const fakeEntities = createFakeEntities(db);
  const indexed: string[] = [];
  return {
    ingestHarness,
    db,
    entities: fakeEntities,
    indexed,
    deps: (overrides = {}) => ({
      db,
      storage: ingestHarness.storage,
      textModel: scriptedModel({}),
      visionModel: createFakeVisionModel(),
      embedder: createFakeEmbedder(),
      settings: {
        confidenceThreshold: 0.7,
        maxNewTypesPerDay: 5,
        schemaLanguage: 'en',
        maxFileSize: ingestHarness.deps.maxFileSize,
      },
      entities: fakeEntities,
      maskSensitive: maskSyntheticIbans,
      indexDocument: (documentId) => {
        indexed.push(documentId);
        return Promise.resolve();
      },
      extractText: () => Promise.resolve(DEFAULT_TEXT),
      ...overrides,
    }),
    ingest: async (label, hint) =>
      (
        await ingestFile(ingestHarness.deps, {
          bytes: syntheticPdf(label),
          filename: `${label}.pdf`,
          source: 'api',
          hint,
        })
      ).id,
    document: async (id) => {
      const [row] = await db.select().from(documents).where(eq(documents.id, id));
      if (row === undefined) throw new Error(`The document ${id} does not exist`);
      return row;
    },
    reset: async () => {
      indexed.length = 0;
      fakeEntities.clear();
      for (const table of [documentLinks, documentDates, facts, chunks, documentPages, jobs]) {
        await db.delete(table);
      }
      await db.delete(documents);
      await db.delete(docTypes);
      await db.delete(entities);
      await ingestHarness.reset();
    },
    dispose: () => ingestHarness.dispose(),
  };
};

export const live = (): AbortSignal => new AbortController().signal;
