import { MAX_ENTITY_CONTEXT_LENGTH } from '@liasse/core/domain';
import { mentionEmbeddingText } from '@liasse/core/entities';
import type { Corpus, GroundTruth } from '../schema/index.ts';
import { type EntityName, entityNamesOf } from './thresholds.ts';

/** A name as one document writes it, with the text resolution would embed for it. */
export interface EntityMentionSample extends EntityName {
  readonly document: string;
  readonly text: string;
}

const escape = (name: string): string => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The name as the line writes it, whatever its case. A name inside a longer word is not
// a mention of it: "CY" in "CYCLES".
const writtenIn =
  (name: string) =>
  (line: string): string | undefined =>
    new RegExp(`(?<![\\p{L}\\p{N}])${escape(name)}(?![\\p{L}\\p{N}])`, 'iu').exec(line)?.[0];

const linesOf = (texts: readonly string[]): readonly string[] =>
  texts
    .flatMap((text) => text.split('\n'))
    .map((line) => line.trim())
    .filter((line) => line !== '');

/**
 * Every name of an entity of the corpus that a document writes, once per document, with
 * the text resolution would embed for it: the name and a line of its context. A name
 * written only as part of a longer name of the same entity is the longer one. A
 * duplicate document repeats its original and is left out.
 */
export const entityMentionsOf = ({
  entities,
  documents,
}: {
  readonly entities: Corpus['entities'];
  readonly documents: readonly Pick<GroundTruth, 'id' | 'duplicate_of' | 'pages'>[];
}): readonly EntityMentionSample[] => {
  const names = entityNamesOf({ entities });
  return documents
    .filter(({ duplicate_of }) => duplicate_of === null)
    .flatMap(({ id, pages }) => {
      const lines = linesOf(pages.map(({ text }) => text));
      return names.flatMap(({ entity, kind, name }) => {
        const longer = names.filter(
          (other) =>
            other.entity === entity &&
            other.name.length > name.length &&
            writtenIn(name)(other.name) !== undefined,
        );
        const at = lines.findIndex(
          (line) =>
            writtenIn(name)(line) !== undefined &&
            longer.every((other) => writtenIn(other.name)(line) === undefined),
        );
        const line = lines[at];
        const written = line === undefined ? undefined : writtenIn(name)(line);
        if (line === undefined || written === undefined) return [];
        // The extraction model writes the context of a mention in its own words; the line
        // that holds the name stands in for it, or the next one when it holds nothing else.
        const context = line === written ? lines[at + 1] : line;
        return [
          {
            document: id,
            entity,
            kind,
            name: written,
            text: mentionEmbeddingText({
              name: written,
              context: context?.slice(0, MAX_ENTITY_CONTEXT_LENGTH),
            }),
          },
        ];
      });
    });
};
