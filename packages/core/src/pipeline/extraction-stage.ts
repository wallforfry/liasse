import { resolveType } from '../registry/read-types.ts';
import { findTypeById, type RegisteredType } from '../registry/type-store.ts';
import type { PipelineDeps } from './deps.ts';
import { loadDocument } from './document.ts';
import { DocumentProcessingError, PipelineConflictError } from './errors.ts';
import { extractionOutputSchema } from './extract/extraction-schema.ts';
import { interpret, type ModelAnswer } from './extract/interpret.ts';
import { awaitsExtraction, type ExtractionMode, storeExtraction } from './extract/store.ts';
import { loadPages } from './pages.ts';
import { extractionPrompt, extractionSystemPrompt } from './prompts/extraction.ts';
import { type BudgetedPages, MAX_EXTRACTION_TOKENS, withinBudget } from './token-budget.ts';

// How many times a result is computed again because the type or an entity changed
// under it, before the job gives up and is retried later.
const MAX_ATTEMPTS = 3;

// The slug and the aliases of a merged type are aliases of its target: a document still
// pointing at the merged type is extracted for the target, and moved to it.
const currentType = async (
  { db }: PipelineDeps,
  typeId: string | null,
): Promise<RegisteredType | undefined> => {
  const type = typeId === null ? undefined : await findTypeById(db, typeId);
  return type?.status === 'merged' ? resolveType(type.slug, { db }) : type;
};

const askModel = async (
  { textModel, settings }: PipelineDeps,
  type: RegisteredType | undefined,
  { pages, truncated }: BudgetedPages,
  signal: AbortSignal,
): Promise<ModelAnswer> => {
  const { object, model } = await textModel.generateObject({
    schema: extractionOutputSchema(type?.fields ?? {}),
    system: extractionSystemPrompt(settings.schemaLanguage),
    prompt: extractionPrompt({ type, pages, truncated }),
    signal,
  });
  return { output: object, model };
};

interface Asked {
  readonly schemaKey: string;
  readonly answer: ModelAnswer;
}

/**
 * One text-model call for the fields, the knowledge, the title and the summary of a
 * document, from the pages stored for it, then one transaction that writes them.
 *
 * The call is made again only when the schema it was made for is no longer the one of
 * the type; an entity merged away meanwhile only costs a new resolution. Resolves to
 * false when the document is gone or no longer awaits this extraction.
 */
export const extractDocument = async (
  deps: PipelineDeps,
  documentId: string,
  mode: ExtractionMode,
  signal: AbortSignal,
): Promise<boolean> => {
  let asked: Asked | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    signal.throwIfAborted();
    const document = await loadDocument(deps.db, documentId);
    if (document === undefined || !awaitsExtraction(document, mode)) return false;
    const type = await currentType(deps, document.typeId);
    const budgeted = withinBudget(
      await loadPages(deps.db, documentId),
      deps.settings.maxExtractionTokens ?? MAX_EXTRACTION_TOKENS,
    );
    if (budgeted.pages.length === 0) throw new DocumentProcessingError('no_text');
    const schemaKey = `${type?.id ?? ''}:${String(type?.version ?? 0)}`;
    if (asked?.schemaKey !== schemaKey) {
      asked = { schemaKey, answer: await askModel(deps, type, budgeted, signal) };
    }
    const fresh = await interpret(deps, asked.answer, {
      type,
      pages: budgeted.pages,
      private: document.private,
    });
    const outcome = await storeExtraction(deps, {
      documentId,
      typeIdRead: document.typeId,
      type,
      fresh,
      model: asked.answer.model,
      truncated: budgeted.truncated,
      mode,
    });
    if (outcome !== 'stale') return outcome === 'stored';
  }
  throw new PipelineConflictError(documentId);
};
