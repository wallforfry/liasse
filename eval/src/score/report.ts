import type { DocumentScore, ScoredSection } from './document.ts';
import type { TypeVerdict } from './knowledge.ts';
import { type Judgement, type Tally, tally } from './outcome.ts';

export interface EvaluationReport {
  readonly documents: number;
  // How many documents got each type verdict; byte-identical copies have none.
  readonly types: Readonly<Record<TypeVerdict, number>>;
  // Precision and recall of each part of a document, over the whole corpus.
  readonly sections: Readonly<Record<ScoredSection, Tally>>;
  // The same for each field of the common core and each type field, by its preferred name.
  readonly core_fields: Readonly<Record<string, Tally>>;
  readonly type_fields: Readonly<Record<string, Tally>>;
  readonly privacy: Tally;
  readonly duplicates: Tally;
  readonly masking: { readonly identifiers: number; readonly leaked: number };
  // Mean over the pages without a text layer; null when none was scored.
  readonly transcription: { readonly pages: number; readonly mean_f1: number | null };
}

const byItem = (judgements: readonly Judgement[]): Readonly<Record<string, Tally>> => {
  const items = [...new Set(judgements.map(({ item }) => item))].sort();
  return Object.fromEntries(
    items.map((item) => [item, tally(judgements.filter((judgement) => judgement.item === item))]),
  );
};

const present = <Value>(value: Value | null): readonly Value[] => (value === null ? [] : [value]);

// Sums the scores of the documents of a run into one report.
export const aggregateReport = (scores: readonly DocumentScore[]): EvaluationReport => {
  const section = (name: ScoredSection): readonly Judgement[] =>
    scores.flatMap((score) => score[name]);
  const withVerdict = (verdict: TypeVerdict): number =>
    scores.filter(({ type }) => type === verdict).length;
  const masking = scores.flatMap((score) => score.masking);
  const pages = scores.flatMap((score) => score.transcription);
  return {
    documents: scores.length,
    types: {
      exact: withVerdict('exact'),
      acceptable: withVerdict('acceptable'),
      parent: withVerdict('parent'),
      mismatch: withVerdict('mismatch'),
      missing: withVerdict('missing'),
    },
    sections: {
      core: tally(section('core')),
      fields: tally(section('fields')),
      key_dates: tally(section('key_dates')),
      links: tally(section('links')),
      subjects: tally(section('subjects')),
      facts: tally(section('facts')),
    },
    core_fields: byItem(section('core')),
    type_fields: byItem(section('fields')),
    privacy: tally(scores.flatMap((score) => present(score.private))),
    duplicates: tally(scores.map((score) => score.duplicate)),
    masking: {
      identifiers: masking.length,
      leaked: masking.filter(({ leakedIn }) => leakedIn.length > 0).length,
    },
    transcription: {
      pages: pages.length,
      mean_f1:
        pages.length === 0 ? null : pages.reduce((sum, { f1 }) => sum + f1, 0) / pages.length,
    },
  };
};
