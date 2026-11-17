import { DEFAULT_LOCAL_EMBEDDING_MODEL } from '@liasse/core/embeddings';
import type { ResolvedSettings } from '@liasse/core/settings';
import type { Answer } from '../schema/index.ts';
import type { AnswerScore, DocumentResult, EvaluationReport } from '../score/index.ts';
import type { ToolCallRecord } from './agent.ts';

/** The models a run measured, as the settings name them. No credential. */
export interface RunModels {
  readonly llm_provider: string;
  readonly text_model: string;
  readonly vision_model: string;
  readonly embedding_provider: string;
  readonly embedding_model: string;
  readonly embedding_dimension: number;
}

export interface QuestionResult extends AnswerScore {
  /** The answer as it was scored, in corpus ids; null when the agent gave none. */
  readonly answer: Answer | null;
  readonly calls: readonly ToolCallRecord[];
  readonly failure: string | null;
}

export interface IngestionSummary {
  /** Documents of the corpus the instance holds nothing for. */
  readonly not_found: readonly string[];
  /** Documents the pipeline left failed or waiting for a review. */
  readonly unfinished: readonly { readonly id: string; readonly status: string }[];
}

/** Everything one run measured: what two runs are compared on. */
export interface RunReport {
  readonly label: string;
  readonly models: RunModels;
  readonly ingestion: IngestionSummary;
  readonly documents: {
    readonly totals: EvaluationReport;
    readonly results: readonly DocumentResult[];
  };
  readonly questions: {
    readonly passed: number;
    readonly total: number;
    readonly results: readonly QuestionResult[];
  };
}

export const modelsOf = ({ llm, embedding }: ResolvedSettings): RunModels => ({
  llm_provider: llm.provider,
  text_model: llm.textModel,
  vision_model: llm.visionModel,
  embedding_provider: embedding.provider,
  embedding_model: embedding.model ?? DEFAULT_LOCAL_EMBEDDING_MODEL,
  embedding_dimension: embedding.dimension,
});
