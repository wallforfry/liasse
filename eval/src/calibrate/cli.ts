import { loadConfig } from '@liasse/core/config';
import { createEmbedder } from '@liasse/core/embeddings';
import type { Embedder } from '@liasse/core/models';
import { loadCorpus } from '../corpus.ts';
import { entityMentionsOf } from './mentions.ts';
import {
  type Calibration,
  calibrate,
  type EntityName,
  entityNamesOf,
  type SimilarityThresholdPair,
  type Spread,
  type ThresholdOutcomes,
} from './thresholds.ts';

// `pnpm eval:calibrate`: measures the entity similarity thresholds with the embedder of
// the configuration, and suggests values. It changes no setting: a suggestion is for a
// person to weigh. Two measures: the bare names of the entities, and the issuers and
// recipients of the documents, embedded with a line of their context as resolution
// embeds a mention. Both are embedded as `passage`, like resolution does.

const figure = (value: number | null): string => (value === null ? '-' : value.toFixed(3));
const describeSpread = (name: string, { pairs, min, median, max }: Spread): string =>
  `  ${name}: ${String(pairs)} pairs, min ${figure(min)}, median ${figure(median)}, max ${figure(max)}`;

const describeOutcomes = (name: string, outcomes: ThresholdOutcomes): readonly string[] => [
  `  ${name}: attach above ${String(outcomes.attach)}, arbitrate from ${String(outcomes.arbitrate)}`,
  `    one entity attached: ${String(outcomes.sameAttached)}, below arbitration: ${String(outcomes.sameBelowArbitrate)}`,
  `    two entities attached: ${String(outcomes.differentAttached)}, arbitrated: ${String(outcomes.differentArbitrated)}`,
];

const describe = (
  title: string,
  samples: number,
  { same, different, current, suggested }: Calibration,
): string =>
  [
    `${title} (${String(samples)}):`,
    describeSpread('Of one entity', same),
    describeSpread('Of two entities of one kind', different),
    ...describeOutcomes('Configured thresholds', current),
    ...(suggested === null
      ? ['  No suggestion: the corpus lacks pairs to measure.']
      : describeOutcomes('Suggested on this corpus', suggested)),
  ].join('\n');

const measure = async (
  embedder: Embedder,
  title: string,
  samples: readonly (EntityName & { readonly text: string })[],
  thresholds: SimilarityThresholdPair,
): Promise<string> => {
  const embeddings = await embedder.embed(
    samples.map(({ text }) => text),
    'passage',
  );
  return describe(title, samples.length, calibrate(samples, embeddings, thresholds));
};

const config = loadConfig(process.env);
const { embedder, close } = await createEmbedder(config.embedding);
try {
  const corpus = await loadCorpus();
  const names = entityNamesOf(corpus).map((name) => ({ ...name, text: name.name }));
  const thresholds = config.pipeline.entitySimilarity;
  const reports = [
    await measure(embedder, 'Bare names of the entities', names, thresholds),
    await measure(
      embedder,
      'Mentions with their line of context',
      entityMentionsOf(corpus),
      thresholds,
    ),
  ];
  process.stdout.write(`Embedder: ${embedder.model}\n${reports.join('\n')}\n`);
} finally {
  await close();
}
