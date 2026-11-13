import { createHash } from 'node:crypto';
import type { Embedder, Embedding } from '../models/ports.ts';

export interface FakeEmbedderOptions {
  readonly dimension?: number;
  readonly isLocal?: boolean;
}

const tokenize = (text: string): readonly string[] =>
  text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token !== '');

type Weights = ReadonlyMap<number, number>;

const accumulate = (tokens: readonly string[], dimension: number): Weights =>
  tokens.reduce((weights, token) => {
    const digest = createHash('sha256').update(token).digest();
    const index = digest.readUInt32BE(0) % dimension;
    const sign = digest.readUInt8(4) % 2 === 0 ? 1 : -1;
    return new Map(weights).set(index, (weights.get(index) ?? 0) + sign);
  }, new Map<number, number>());

const norm = (weights: Weights): number => Math.hypot(...weights.values());

// A text with no token, or whose tokens cancel out, still needs a unit vector:
// cosine distance is undefined for the zero vector.
const weigh = (text: string, dimension: number): Weights => {
  const weights = accumulate(tokenize(text), dimension);
  return norm(weights) === 0 ? accumulate([''], dimension) : weights;
};

const embedText = (text: string, dimension: number): Embedding => {
  const weights = weigh(text, dimension);
  const length = norm(weights);
  return Array.from({ length: dimension }, (_, index) => (weights.get(index) ?? 0) / length);
};

export const createFakeEmbedder = ({
  dimension = 384,
  isLocal = true,
}: FakeEmbedderOptions = {}): Embedder => ({
  dimension,
  model: 'fake-embedder',
  isLocal,
  embed: (texts) => Promise.resolve(texts.map((text) => embedText(text, dimension))),
});
