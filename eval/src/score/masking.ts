import type { GroundTruth, SensitiveIdentifierKind, SystemDocument } from '../schema/index.ts';
import { compactIdentifier } from './compare.ts';

export interface MaskingResult {
  readonly kind: SensitiveIdentifierKind;
  // The parts of the stored document that hold the identifier in clear; empty when masked.
  readonly leakedIn: readonly string[];
}

const leaves = (value: unknown): readonly string[] => {
  if (typeof value === 'string') return [value];
  if (typeof value === 'number') return [String(value)];
  if (Array.isArray(value)) return value.flatMap(leaves);
  return typeof value === 'object' && value !== null ? Object.values(value).flatMap(leaves) : [];
};

// Everything the system stores about a document besides its page text, which is the one
// place where the full identifier may be read.
const storedParts = (output: SystemDocument): Readonly<Record<string, unknown>> => ({
  core: output.core,
  key_dates: output.key_dates,
  fields: output.fields,
  extra: output.extra,
  provenance: output.provenance,
  title: output.title,
  summary: output.summary,
  subjects: output.subjects,
  facts: output.facts,
});

// Each value is searched on its own: joined, the digits of two unrelated values could
// spell an identifier that was never stored.
export const scoreMasking = (
  truth: GroundTruth,
  output: SystemDocument,
): readonly MaskingResult[] =>
  truth.masking.map(({ kind, clear }) => ({
    kind,
    leakedIn: Object.entries(storedParts(output))
      .filter(([, part]) =>
        leaves(part).some((leaf) => compactIdentifier(leaf).includes(compactIdentifier(clear))),
      )
      .map(([name]) => name),
  }));
