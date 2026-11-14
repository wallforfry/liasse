import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { StubServer } from '@liasse/core/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadCorpus, loadQuestions } from '../corpus.ts';
import type { Corpus, QuestionSet } from '../schema/index.ts';
import { createCorpusIndex } from '../score/index.ts';
import { deterministicEnv, oracleAgent, startModelStub } from './deterministic.test-helper.ts';
import type { RunReport } from './report.ts';
import { runEvaluation } from './run.ts';

// One run ingests the fifty files through the whole pipeline. That was measured at about
// 20 s on a laptop; the bound is far above it and only ends a hang.
const RUN_TIMEOUT_MILLISECONDS = 600_000;

const quiet = { event: () => undefined, notice: () => undefined };

describe('a deterministic run of the harness', () => {
  let stub: StubServer;
  let folder: string;
  let corpus: Corpus;
  let questionSet: QuestionSet;
  let report: RunReport;

  beforeAll(async () => {
    [corpus, questionSet] = await Promise.all([loadCorpus(), loadQuestions()]);
    stub = await startModelStub();
    folder = await mkdtemp(join(tmpdir(), 'liasse-eval-run-'));
    const index = createCorpusIndex(corpus);
    report = await runEvaluation({
      label: 'deterministic',
      env: deterministicEnv(stub.url, folder),
      agentModel: (ids) => oracleAgent(questionSet.questions, index, ids),
      logger: quiet,
    });
  }, RUN_TIMEOUT_MILLISECONDS);

  afterAll(async () => {
    await stub.close();
    await rm(folder, { recursive: true, force: true });
  });

  it('finds every document of the corpus in the instance, the attachment included', () => {
    expect(report.ingestion.not_found).toEqual([]);
  });

  // The stand-in extracts nothing, so every document waits for a review; none fails.
  it('reports the documents the pipeline left unfinished', () => {
    const statuses = new Set(report.ingestion.unfinished.map(({ status }) => status));
    expect([...statuses]).toEqual(['needs_review']);
  });

  it('scores what the instance stored for every document as a system output', () => {
    expect(report.documents.results).toHaveLength(corpus.documents.length);
    expect(report.documents.results.filter(({ kind }) => kind === 'invalid')).toEqual([]);
    expect(report.documents.totals.documents).toBe(corpus.documents.length);
  });

  it('reports the copy recognised by ingestion as the duplicate of its original', () => {
    const copy = report.documents.results.find(({ id }) => id === 'energy-bill-2025-06-copy');
    expect(copy?.kind === 'scored' ? copy.duplicate.outcome : undefined).toBe('correct');
    expect(report.documents.totals.duplicates.invented).toBe(0);
  });

  it('scores the transcription of every page without a text layer', () => {
    const scanned = corpus.documents.flatMap(({ pages }) =>
      pages.filter(({ method }) => method === 'vision'),
    );
    expect(report.documents.totals.transcription.pages).toBe(scanned.length);
  });

  it('reports per-field precision and recall of the common core', () => {
    expect(Object.keys(report.documents.totals.core_fields)).toEqual(
      expect.arrayContaining(['amount', 'document_date', 'issuer']),
    );
  });

  it('answers every question through the MCP tools, and scores the answers', () => {
    expect(report.questions.total).toBe(questionSet.questions.length);
    expect(report.questions.results.filter(({ pass }) => !pass)).toEqual([]);
    expect(report.questions.passed).toBe(questionSet.questions.length);
  });

  it('makes the calls of each question on the tools of the server', () => {
    expect(report.questions.results.map(({ calls }) => calls.map(({ tool }) => tool))).toEqual(
      questionSet.questions.map(({ tools }) => tools.map(({ tool }) => tool)),
    );
  });

  it('names the models of the run', () => {
    expect(report.models).toMatchObject({
      text_model: 'text-model',
      embedding_model: 'embedding-model',
    });
  });
});
