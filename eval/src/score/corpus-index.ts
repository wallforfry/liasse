import { entityNameKey } from '@liasse/core/domain';
import type { Corpus, EntityTruth, GroundTruth, SubjectDefinition } from '../schema/index.ts';
import { compactIdentifier, foldText } from './compare.ts';

export class UnknownKeyError extends Error {
  override readonly name = 'UnknownKeyError';
}

export interface CorpusIndex {
  readonly document: (id: string) => GroundTruth;
  // Every name the entity goes by: its canonical name, then its aliases.
  readonly entityNames: (key: string) => readonly string[];
  // The names of the entity of the corpus that goes by this name, or the name alone.
  readonly namesOf: (name: string) => readonly string[];
  readonly subject: (key: string) => SubjectDefinition;
}

const namesOfEntity = ({ canonical_name, aliases }: EntityTruth): readonly string[] => [
  canonical_name,
  ...aliases,
];

const byKey = <Item>(kind: string, items: readonly Item[], keyOf: (item: Item) => string) => {
  const map = new Map(items.map((item) => [keyOf(item), item]));
  return (key: string): Item => {
    const found = map.get(key);
    if (found === undefined) throw new UnknownKeyError(`The corpus has no ${kind} "${key}"`);
    return found;
  };
};

export const createCorpusIndex = (corpus: Corpus): CorpusIndex => {
  const entity = byKey('entity', corpus.entities, ({ key }) => key);
  return {
    document: byKey('document', corpus.documents, ({ id }) => id),
    entityNames: (key) => namesOfEntity(entity(key)),
    namesOf: (name) => {
      const known = corpus.entities.find((candidate) =>
        namesOfEntity(candidate).some((alias) => entityNameKey(alias) === entityNameKey(name)),
      );
      return known === undefined ? [name] : namesOfEntity(known);
    },
    subject: byKey('subject', corpus.subjects, ({ key }) => key),
  };
};

// A label names a subject when it is its label or an alias, or when it carries one of its
// identifiers: a plate, a contract number, a street.
export const labelNamesSubject = (label: string, subject: SubjectDefinition): boolean => {
  const folded = foldText(label);
  const compact = compactIdentifier(label);
  return (
    [subject.label, ...subject.aliases].some((name) => foldText(name) === folded) ||
    subject.identifiers.some((identifier) => compact.includes(compactIdentifier(identifier)))
  );
};
