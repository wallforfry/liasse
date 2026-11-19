import { NO_SOURCE_FILES } from '../testing/no-source-files.ts';
import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { chunks, documentPages, documents } from '../db/schema/documents.ts';
import { jobs } from '../db/schema/jobs.ts';
import { documentDates, documentLinks, facts, subjects } from '../db/schema/knowledge.ts';
import { docTypes, entities } from '../db/schema/registry.ts';
import { deriveIdentifierKey } from '../entities/sensitive.ts';
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
import { entitiesOf } from './bindings.ts';
import type { EntityMentionInput, EntityResolver, PipelineDeps } from './deps.ts';

// A structurally valid number of an account that does not exist.
export const SYNTHETIC_IBAN = 'DE37 9999 9999 0123 4567 89';
export const SYNTHETIC_IBAN_MASKED = '****6789';

export const TEST_IDENTIFIER_KEY = deriveIdentifierKey('synthetic-identifier-secret-0123456789');

export interface RecordingEntities extends EntityResolver {
  readonly mentions: readonly EntityMentionInput[];
  readonly options: readonly { readonly allowExternalEmbedding: boolean }[];
  readonly clear: () => void;
}

// The real entity resolution, which also notes what it was asked.
const recording = (real: EntityResolver): RecordingEntities => {
  const mentions: EntityMentionInput[] = [];
  const options: { readonly allowExternalEmbedding: boolean }[] = [];
  return {
    ...real,
    mentions,
    options,
    clear: () => {
      mentions.length = 0;
      options.length = 0;
    },
    resolve: (mention, option) => {
      mentions.push(mention);
      options.push(option);
      return real.resolve(mention, option);
    },
  };
};

export const isClassification = ({ system }: FakeTextRequest): boolean =>
  system.startsWith('You file');

const isArbitration = ({ system }: FakeTextRequest): boolean =>
  system.startsWith('You decide whether a name read in a document designates');

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
    // Entity resolution asks about a candidate only similarity designates, such as the
    // entity a concurrent job of the same document has just created; no script picks one.
    if (isArbitration(request)) return { choice: 'none' };
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
  readonly entities: RecordingEntities;
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
  const base: PipelineDeps = {
    db,
    storage: ingestHarness.storage,
    sourceFiles: NO_SOURCE_FILES,
    textModel: scriptedModel({}),
    visionModel: createFakeVisionModel(),
    embedder: createFakeEmbedder(),
    identifierKey: TEST_IDENTIFIER_KEY,
    settings: {
      confidenceThreshold: 0.7,
      schemaLanguage: 'en',
      maxFileSize: ingestHarness.deps.maxFileSize,
    },
  };
  const fakeEntities = recording(entitiesOf(base));
  const indexed: string[] = [];
  return {
    ingestHarness,
    db,
    entities: fakeEntities,
    indexed,
    deps: (overrides = {}) => ({
      ...base,
      entities: fakeEntities,
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
      for (const table of [
        documentLinks,
        documentDates,
        facts,
        subjects,
        chunks,
        documentPages,
        jobs,
      ]) {
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
