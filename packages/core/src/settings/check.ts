import type { SettingsCheck, SettingsPartCheck } from '@liasse/contract';
import { z } from 'zod';
import { HindsightError } from '../hindsight/errors.ts';
import { EmbeddingDimensionError, ModelOutputError, ModelProviderError } from '../models/errors.ts';
import type { ModelFactories } from './factories.ts';
import type { ResolvedSettings } from './resolve.ts';

// A provider refuses a page it cannot decode (OpenAI answers HTTP 400 invalid_value), so the
// blank page comes from a real encoder rather than bytes written by hand.
const PROBE_PAGE_EDGE_PX = 32;
const PROBE_PAGE_QUALITY = 90;
const WHITE = 255;

const buildProbePage = async (): Promise<Uint8Array> => {
  const { encode } = await import('jpeg-js');
  const data = new Uint8Array(PROBE_PAGE_EDGE_PX * PROBE_PAGE_EDGE_PX * 4).fill(WHITE);
  return Uint8Array.from(
    encode({ width: PROBE_PAGE_EDGE_PX, height: PROBE_PAGE_EDGE_PX, data }, PROBE_PAGE_QUALITY)
      .data,
  );
};

const PROBE_TEXT = 'Liasse settings check';
const PROBE_DOCUMENT = 'liasse-settings-check';
const MODEL_PROBE_TIMEOUT_MS = 60_000;

const OK: SettingsPartCheck = { status: 'ok' };
const SKIPPED: SettingsPartCheck = { status: 'skipped' };

const failed = (code: string, message: string): SettingsPartCheck => ({
  status: 'failed',
  code,
  message,
});

const statusOf = (statusCode: number | undefined): string =>
  statusCode === undefined ? '' : ` with HTTP ${String(statusCode)}`;

// Only what Liasse wrote: the message of a provider may quote the request, its key included.
const failureOf = (error: unknown): SettingsPartCheck => {
  if (error instanceof EmbeddingDimensionError) {
    return failed(
      'dimension_mismatch',
      `The embedder answers vectors of ${String(error.actual)} dimensions, and EMBEDDING_DIM ` +
        `is ${String(error.expected)}.`,
    );
  }
  if (error instanceof ModelProviderError) {
    return failed(
      'provider_error',
      `The provider ${error.provider} failed the call${statusOf(error.statusCode)}` +
        `${error.code === undefined ? '' : ` (${error.code})`}.`,
    );
  }
  if (error instanceof HindsightError) {
    return failed(
      'hindsight_error',
      `Hindsight failed the call${statusOf(error.statusCode)}` +
        `${error.code === undefined ? '' : ` (${error.code})`}.`,
    );
  }
  if (error instanceof ModelOutputError) {
    return failed('invalid_output', 'The model answered, but not in the shape Liasse asks for.');
  }
  const name = error instanceof Error ? error.name : 'unknown';
  return failed('unreachable', `The call could not be made (${name}).`);
};

const attempt = async (probe: () => Promise<void>): Promise<SettingsPartCheck> => {
  try {
    await probe();
    return OK;
  } catch (error) {
    return failureOf(error);
  }
};

const answerSchema = z.object({ ok: z.boolean() });

const checkEmbedder = async (
  factories: ModelFactories,
  { embedding }: ResolvedSettings,
): Promise<void> => {
  const { embedder, close } = await factories.embedder(embedding);
  try {
    const [vector] = await embedder.embed([PROBE_TEXT], 'query');
    const length = vector?.length ?? 0;
    if (length !== embedding.dimension) {
      throw new EmbeddingDimensionError(embedder.model, embedding.dimension, length);
    }
  } finally {
    await close();
  }
};

/**
 * Tries each part of the settings with one short call, in parallel, and saves nothing:
 * a text answer, the reading of one blank page, one embedding of the length of
 * `EMBEDDING_DIM`, and when Hindsight is on, the forget of a document it does not hold.
 */
export const checkSettings = async (
  factories: ModelFactories,
  settings: ResolvedSettings,
): Promise<SettingsCheck> => {
  const signal = (): AbortSignal => AbortSignal.timeout(MODEL_PROBE_TIMEOUT_MS);
  const { hindsight } = settings;
  const [textModel, visionModel, embedder, hindsightCheck] = await Promise.all([
    attempt(async () => {
      await factories.textModel(settings.llm).generateObject({
        schema: answerSchema,
        system: 'Answer with ok set to true.',
        prompt: PROBE_TEXT,
        signal: signal(),
      });
    }),
    attempt(async () => {
      await factories.visionModel(settings.llm).transcribePage({
        image: await buildProbePage(),
        mime: 'image/jpeg',
        prompt: 'Transcribe the text of this page, if any.',
        signal: signal(),
      });
    }),
    attempt(() => checkEmbedder(factories, settings)),
    hindsight === undefined
      ? Promise.resolve(SKIPPED)
      : attempt(async () => {
          await factories.hindsightProbe(hindsight).forget(PROBE_DOCUMENT, signal());
        }),
  ]);
  return { text_model: textModel, vision_model: visionModel, embedder, hindsight: hindsightCheck };
};
