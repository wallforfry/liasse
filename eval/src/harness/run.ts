import type { Config } from '@liasse/core/config';
import { type Database, documents } from '@liasse/core/db';
import type { TextModel } from '@liasse/core/models';
import type { RuntimeOptions } from '@liasse/server/runtime';
import { inArray } from 'drizzle-orm';
import { loadCorpus, loadQuestions } from '../corpus.ts';
import type { Corpus, QuestionSet } from '../schema/index.ts';
import {
  aggregateReport,
  type CorpusIndex,
  createCorpusIndex,
  type DocumentResult,
  scoreAnswer,
  scoreDocument,
} from '../score/index.ts';
import { answerQuestion } from './agent.ts';
import { toCorpusAnswer } from './agent-schema.ts';
import { type CorpusIds, ingestCorpus } from './ingest.ts';
import { cleanUpOnInterrupt } from './interrupt.ts';
import { type Env, type Instance, startInstance } from './instance.ts';
import { openMcpSession } from './mcp-session.ts';
import { type IngestionSummary, modelsOf, type QuestionResult, type RunReport } from './report.ts';
import { readSystemOutput } from './system-output.ts';

export interface RunOptions {
  /** Names the run in its report: the model or the prompt version it measures. */
  readonly label: string;
  /** Read like the server reads `process.env`. */
  readonly env: Env;
  /** The model that answers the questions, once the corpus is in. */
  readonly agentModel: (ids: CorpusIds, config: Config) => TextModel;
  readonly logger?: RuntimeOptions['logger'];
}

const UNFINISHED = ['failed', 'needs_review'] as const;

const summarizeIngestion = async (
  db: Database,
  corpus: Corpus,
  ids: CorpusIds,
): Promise<IngestionSummary> => {
  const placed = corpus.documents.flatMap(({ id }) => {
    const liasseId = ids.liasseOf(id);
    return liasseId === undefined ? [] : [{ id, liasseId }];
  });
  const rows = await db
    .select({ id: documents.id, status: documents.status })
    .from(documents)
    .where(
      inArray(
        documents.id,
        placed.map(({ liasseId }) => liasseId),
      ),
    );
  const statusOf = new Map(rows.map(({ id, status }) => [id, status]));
  return {
    not_found: corpus.documents
      .filter(({ id }) => ids.liasseOf(id) === undefined)
      .map(({ id }) => id),
    unfinished: placed.flatMap(({ id, liasseId }) => {
      const status = statusOf.get(liasseId) ?? 'missing';
      return UNFINISHED.some((unfinished) => unfinished === status) ? [{ id, status }] : [];
    }),
  };
};

const scoreDocuments = async (
  instance: Instance,
  corpus: Corpus,
  ids: CorpusIds,
  index: CorpusIndex,
): Promise<readonly DocumentResult[]> => {
  // One document after the other: the reads share the pool of the harness connection.
  const results: DocumentResult[] = [];
  for (const truth of corpus.documents) {
    results.push(scoreDocument(truth, await readSystemOutput(instance.db, ids, truth.id), index));
  }
  return results;
};

const answerQuestions = async (
  instance: Instance,
  { reference_date, questions }: QuestionSet,
  model: TextModel,
  ids: CorpusIds,
  index: CorpusIndex,
): Promise<readonly QuestionResult[]> => {
  const session = await openMcpSession(instance);
  try {
    // One question at a time, as an operator's rate limits expect.
    const results: QuestionResult[] = [];
    for (const question of questions) {
      const run = await answerQuestion({ model, session, referenceDate: reference_date }, question);
      const answer = run.answer === undefined ? null : toCorpusAnswer(run.answer, ids);
      results.push({
        ...scoreAnswer(question, answer ?? undefined, index),
        answer,
        calls: run.calls,
        failure: run.failure ?? null,
      });
    }
    return results;
  } finally {
    await session.close();
  }
};

/**
 * One run of the evaluation: a throwaway instance with the configured models ingests the
 * corpus through the API, each document is scored against its truth, and the agent
 * answers the reference questions through the MCP tools. The instance is gone afterwards.
 */
export const runEvaluation = async ({
  label,
  env,
  agentModel,
  logger,
}: RunOptions): Promise<RunReport> => {
  const [corpus, questionSet] = await Promise.all([loadCorpus(), loadQuestions()]);
  const index = createCorpusIndex(corpus);
  const instance = await startInstance(env, logger === undefined ? {} : { logger });
  try {
    return await cleanUpOnInterrupt(instance.stop, async () => {
      const ids = await ingestCorpus(instance, corpus);
      const results = await scoreDocuments(instance, corpus, ids, index);
      const model = agentModel(ids, instance.config);
      const answers = await answerQuestions(instance, questionSet, model, ids, index);
      return {
        label,
        models: modelsOf(instance.config),
        ingestion: await summarizeIngestion(instance.db, corpus, ids),
        documents: { totals: aggregateReport(results), results },
        questions: {
          passed: answers.filter(({ pass }) => pass).length,
          total: answers.length,
          results: answers,
        },
      };
    });
  } finally {
    await instance.stop();
  }
};
