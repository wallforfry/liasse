import type { SubjectKind } from '@liasse/contract/domain';
import type { Database } from '../db/client.ts';
import { nameTokens } from '../domain/entity-name.ts';
import { visibleSubjectIds } from './read-shared.ts';
import { isWrittenAs } from './subject-identifiers.ts';
import { subjectLabelKey } from './subject-label.ts';
import { loadSubjects, type Subject } from './subject-store.ts';

const namesOf = ({ canonicalName, aliases }: Subject): readonly string[] => [
  canonicalName,
  ...aliases,
];

/**
 * The subjects a query designates, the surest reading first: a whole label, then an
 * identifier as written, then words that each start a word of one label.
 */
export const designatedBy = (subjects: readonly Subject[], query: string): readonly Subject[] => {
  const key = subjectLabelKey(query);
  const byLabel = subjects.filter((subject) =>
    namesOf(subject).some((name) => subjectLabelKey(name) === key),
  );
  if (byLabel.length > 0) return byLabel;
  const byIdentifier = subjects.filter(({ identifiers }) =>
    identifiers.some((identifier) => isWrittenAs(identifier, query)),
  );
  if (byIdentifier.length > 0) return byIdentifier;
  const words = nameTokens(query);
  if (words.length === 0) return [];
  return subjects.filter((subject) =>
    namesOf(subject).some((name) => {
      const tokens = nameTokens(name);
      return words.every((word) => tokens.some((token) => token.startsWith(word)));
    }),
  );
};

/**
 * A subject a reader may see: one a visible document concerns, and, unless the reader
 * asked for private documents, one a public document has named.
 */
export const shownTo =
  (visible: ReadonlySet<string>, includePrivate: boolean) =>
  (subject: Subject): boolean =>
    visible.has(subject.id) && (includePrivate || !subject.private);

/** The subjects a reader may see, oldest first, of one kind when it is given. */
export const loadVisibleSubjects = async (
  db: Database,
  includePrivate: boolean,
  kind?: SubjectKind,
): Promise<readonly Subject[]> => {
  const visible = await visibleSubjectIds(db, includePrivate);
  return (await loadSubjects(db, kind)).filter(shownTo(visible, includePrivate));
};
