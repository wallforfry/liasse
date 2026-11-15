import type { EntityKind } from '@liasse/contract/domain';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db/client.ts';
import { entities } from '../db/schema/registry.ts';
import type { Embedder, Embedding } from '../models/ports.ts';
import {
  createFakeTextModel,
  type FakeTextModel,
  type FakeTextScript,
} from '../testing/fake-text-model.ts';
import { TEST_EMBEDDING_DIM } from '../testing/test-database.ts';
import {
  type MentionIdentifier,
  mergeIdentifiers,
  storeIdentifier,
  toIdentifiersColumn,
} from './identifiers.ts';
import { deriveIdentifierKey } from './sensitive.ts';

export const TEST_IDENTIFIER_KEY = deriveIdentifierKey('synthetic-identifier-secret-0123456789');

// Structurally valid values of accounts and cards that do not exist.
export const SYNTHETIC_IBAN = 'FR759999900001SYNTHETIC0146';
export const OTHER_SYNTHETIC_IBAN = 'DE37999999990123456789';
export const SYNTHETIC_CARD = '4242424242424242';

// A unit vector whose cosine with the first axis is the one given. Each axis gives a
// distinct vector, so several candidates can stand at chosen similarities of one mention.
export const atSimilarity = (cosine: number, axis = 1): Embedding =>
  Array.from({ length: TEST_EMBEDDING_DIM }, (_, index) => {
    if (index === 0) return cosine;
    return index === axis ? Math.sqrt(1 - cosine * cosine) : 0;
  });

export interface RecordingEmbedder extends Embedder {
  readonly texts: readonly string[];
}

// Embeds every text on the first axis, and records what it was asked to embed.
export const recordingEmbedder = (isLocal = true): RecordingEmbedder => {
  const texts: string[] = [];
  return {
    dimension: TEST_EMBEDDING_DIM,
    model: 'recording-embedder',
    isLocal,
    texts,
    embed: (batch) => {
      texts.push(...batch);
      return Promise.resolve(batch.map(() => atSimilarity(1)));
    },
  };
};

export interface SeededEntity {
  readonly kind?: EntityKind;
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly identifiers?: readonly MentionIdentifier[];
  readonly embedding?: Embedding;
}

export const seedEntity = async (
  db: Database,
  { kind = 'org', name, aliases = [], identifiers = [], embedding }: SeededEntity,
): Promise<string> => {
  const [row] = await db
    .insert(entities)
    .values({
      kind,
      canonicalName: name,
      aliases,
      identifiers: toIdentifiersColumn(
        mergeIdentifiers(
          [],
          identifiers.flatMap((identifier) => storeIdentifier(TEST_IDENTIFIER_KEY, identifier)),
        ),
      ),
      ...(embedding === undefined ? {} : { embedding }),
    })
    .returning({ id: entities.id });
  if (row === undefined) throw new Error('The entity was not seeded');
  return row.id;
};

interface Deferred {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}

const deferred = (): Deferred => {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};

export interface GatedTextModel extends FakeTextModel {
  // Settles once the model has been called.
  readonly entered: Promise<void>;
  // Lets every call, pending or to come, answer.
  readonly release: () => void;
}

// A text model that holds its answers until it is released, as a slow provider would.
export const gatedTextModel = (script: FakeTextScript): GatedTextModel => {
  const inner = createFakeTextModel(script);
  const entered = deferred();
  const gate = deferred();
  return {
    calls: inner.calls,
    entered: entered.promise,
    release: gate.resolve,
    generateObject: async (request) => {
      entered.resolve();
      await gate.promise;
      return inner.generateObject(request);
    },
  };
};

const waitingSchema = z.tuple([z.object({ waiting: z.number() })]);

// Resolves once a session of this database is queued behind the entity lock. A test that
// only checked the outcome would pass by luck when the other session did not wait at all.
export const untilSomeoneWaitsForTheEntityLock = async (db: Database): Promise<void> => {
  const [{ waiting }] = waitingSchema.parse(
    await db.execute(sql`
      SELECT count(*)::int AS waiting FROM pg_locks
      WHERE locktype = 'advisory' AND NOT granted
        AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
    `),
  );
  if (waiting === 0) await untilSomeoneWaitsForTheEntityLock(db);
};
