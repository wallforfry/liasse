import { loadConfig } from '@liasse/core/config';
import { createEmbedder } from '@liasse/core/embeddings';
import { ENTITY_ARBITRATION_SIMILARITY, ENTITY_ATTACH_SIMILARITY } from '@liasse/core/domain';
import { loadCorpus } from '../corpus.ts';
import { type Calibration, calibrate, entityNamesOf, type Spread } from './thresholds.ts';

// `pnpm eval:calibrate`: measures the entity similarity thresholds on the names of the
// corpus with the embedder of the configuration, and suggests values. It changes no
// default: a suggestion is for a person to weigh against more names than these.
// Names are embedded bare, as `passage` like resolution does; a mention also carries a
// line of its context, which this measure leaves out.

const CURRENT = { attach: ENTITY_ATTACH_SIMILARITY, arbitrate: ENTITY_ARBITRATION_SIMILARITY };

const figure = (value: number | null): string => (value === null ? '-' : value.toFixed(3));
const describeSpread = (name: string, { pairs, min, median, max }: Spread): string =>
  `${name}: ${String(pairs)} pairs, min ${figure(min)}, median ${figure(median)}, max ${figure(max)}`;

const describe = (model: string, { same, different, current, suggested }: Calibration): string =>
  [
    `Embedder: ${model}`,
    describeSpread('Names of one entity', same),
    describeSpread('Names of two entities of one kind', different),
    `Current thresholds: attach above ${String(current.attach)}, arbitrate from ${String(current.arbitrate)}`,
    `  names of one entity attached: ${String(current.sameAttached)}, below arbitration: ${String(current.sameBelowArbitrate)}`,
    `  names of two entities attached: ${String(current.differentAttached)}, arbitrated: ${String(current.differentArbitrated)}`,
    suggested === null
      ? 'No suggestion: the corpus lacks pairs to measure.'
      : `Suggested on this corpus: attach above ${String(suggested.attach)}, arbitrate from ${String(suggested.arbitrate)}`,
  ].join('\n');

const config = loadConfig(process.env);
const { embedder, close } = await createEmbedder(config.embedding);
try {
  const names = entityNamesOf(await loadCorpus());
  const embeddings = await embedder.embed(
    names.map(({ name }) => name),
    'passage',
  );
  process.stdout.write(`${describe(embedder.model, calibrate(names, embeddings, CURRENT))}\n`);
} finally {
  await close();
}
