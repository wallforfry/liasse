import type { Database } from '../db/client.ts';
import type { EntityIdentifierType, EntityKind, SchemaLanguage } from '../domain/enums.ts';
import type { EntityProvenance } from '../domain/provenance.ts';
import type { IdentifierKey } from '../entities/sensitive.ts';
import type { SimilarityThresholds } from '../entities/similarity.ts';
import type { Transaction } from '../ingest/existing-document.ts';
import type { KnowledgeDocument, KnowledgeInput } from '../knowledge/input.ts';
import type { PersistedKnowledge } from '../knowledge/persist-knowledge.ts';
import type { Embedder, TextModel, VisionModel } from '../models/ports.ts';
import type { Storage } from '../storage/port.ts';
import type { ExtractedText, ExtractTextDeps, ExtractTextInput } from '../text/types.ts';
import type { TextProcessLimits } from './text-process/limits.ts';

// Entity resolution, masking, indexing and the knowledge store are bound to the real functions in
// `bindings.ts`. The shapes below are what the pipeline uses of them, and what a caller
// may substitute.

export interface ResolvedMention {
  readonly provenance: EntityProvenance;
  /** Identifiers of the mention the resolver did not keep. */
  readonly droppedIdentifiers: number;
}

export interface EntityMentionInput {
  readonly name: string;
  readonly kind?: EntityKind;
  readonly identifiers?: readonly {
    readonly type: Exclude<EntityIdentifierType, 'other'>;
    readonly value: string;
  }[];
  readonly context?: string;
}

export interface EntityResolver {
  /** Undefined for a mention the resolver refuses as invalid. */
  readonly resolve: (
    mention: EntityMentionInput,
    options: { readonly allowExternalEmbedding: boolean },
  ) => Promise<ResolvedMention | undefined>;
  /**
   * Every write of an entity id runs under this lock, after `missingIds` answered that
   * each id still exists: an id that a merge removed meanwhile must be resolved again.
   */
  readonly withLock: <Outcome>(
    executor: Database | Transaction,
    work: (tx: Transaction) => Promise<Outcome>,
  ) => Promise<Outcome>;
  readonly missingIds: (tx: Transaction, ids: readonly string[]) => Promise<readonly string[]>;
}

/** Replaces every sensitive identifier written in a text by its masked form. */
export type MaskSensitive = (text: string) => string;

export type IndexDocument = (documentId: string) => Promise<unknown>;

/**
 * Stores the knowledge of a document in the transaction that writes the document, once
 * its row is written, in place of what a previous extraction stored.
 */
export type PersistKnowledge = (
  tx: Transaction,
  document: KnowledgeDocument,
  knowledge: KnowledgeInput,
) => Promise<PersistedKnowledge>;
export type ExtractDocumentText = (
  input: ExtractTextInput,
  deps: Pick<ExtractTextDeps, 'vision' | 'signal' | 'limits'>,
) => Promise<ExtractedText>;

export interface PipelineSettings {
  /** `CONFIDENCE_THRESHOLD`, `MAX_NEW_TYPES_PER_DAY`, `SCHEMA_LANGUAGE`, `MAX_FILE_SIZE`. */
  readonly confidenceThreshold: number;
  readonly maxNewTypesPerDay: number;
  readonly schemaLanguage: SchemaLanguage;
  readonly maxFileSize: number;
  /** `MAX_VISION_PAGES`. */
  readonly maxVisionPages?: number;
  /** Tokens of document text one extraction call may carry; `MAX_EXTRACTION_TOKENS` by default. */
  readonly maxExtractionTokens?: number;
  /** Memory and CPU the process that reads a file may use; `DEFAULT_TEXT_PROCESS_LIMITS` by default. */
  readonly textProcessLimits?: Partial<TextProcessLimits>;
  /**
   * Thresholds of the similarity rule of entity resolution; those of the specification
   * by default. They were never calibrated on a real embedder.
   */
  readonly entitySimilarity?: SimilarityThresholds;
}

export interface PipelineDeps {
  readonly db: Database;
  readonly storage: Storage;
  readonly textModel: TextModel;
  readonly visionModel: VisionModel;
  readonly embedder: Embedder;
  readonly settings: PipelineSettings;
  /** `deriveIdentifierKey(config.auth.fileUrlSecret)`: the key of the identifier hashes. */
  readonly identifierKey: IdentifierKey;
  /** Entity resolution of `@liasse/core/entities`, with the models above, by default. */
  readonly entities?: EntityResolver;
  /** `redactSensitiveIdentifiers` of `@liasse/core/entities` by default. */
  readonly maskSensitive?: MaskSensitive;
  /** `indexDocument` of `@liasse/core/search`, with the embedder above, by default. */
  readonly indexDocument?: IndexDocument;
  /** `createPersistKnowledge` of `@liasse/core/knowledge`, with the key above, by default. */
  readonly persistKnowledge?: PersistKnowledge;
  /** Called after a document is indexed, at least once: it must be idempotent. */
  readonly afterIndexed?: (documentId: string) => Promise<void>;
  /** `extractTextInChild` by default: text extraction never runs in the server's process. */
  readonly extractText?: ExtractDocumentText;
  readonly now?: () => Date;
}
