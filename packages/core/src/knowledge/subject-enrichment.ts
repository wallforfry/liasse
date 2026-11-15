import type { EntityMatchRule } from '@liasse/contract/domain';
import type { Embedding } from '../models/ports.ts';
import { mergeSubjectIdentifiers } from './subject-identifier-rules.ts';
import { subjectIdentifiersFor, withSubjectAliases } from './subject-match.ts';
import type { SubjectMention } from './subject-mention.ts';
import {
  replaceSubjectIdentity,
  type Subject,
  type SubjectTransaction,
  updateSubjectNames,
} from './subject-store.ts';

// What is known of the document a mention was read in.
export interface SubjectOrigin {
  // The entity that issued the document: the scope of its contract numbers.
  readonly issuerId: string | undefined;
  readonly private: boolean;
}

export interface Attachment {
  readonly subject: Subject;
  readonly match: EntityMatchRule;
  readonly confidence: number;
  // Labels the subject is now known under as well.
  readonly aliases: readonly string[];
}

// The names a subject takes from a mention of a public document: the identifiers it may
// take and did not have, and the aliases the rule adds.
const enrichPublic = async (
  tx: SubjectTransaction,
  { subject, aliases }: Attachment,
  mention: SubjectMention,
  everySubject: readonly Subject[],
): Promise<void> => {
  const names = {
    aliases: withSubjectAliases(subject, aliases),
    identifiers: mergeSubjectIdentifiers(
      subject.identifiers,
      subjectIdentifiersFor(subject, everySubject, mention.identifiers),
    ),
  };
  const unchanged =
    names.aliases.length === subject.aliases.length &&
    names.identifiers.length === subject.identifiers.length;
  if (!unchanged) await updateSubjectNames(tx, subject.id, names);
};

/**
 * What a mention adds to the subject it was attached to.
 *
 * A private document may say which subject it is about, but nothing it says is stored:
 * no identifier, alias or label, which every reader of the subject would see.
 *
 * A subject only private documents named is private itself. The first public document
 * attached to it makes it public, and its identity is then what that document says: its
 * label, the identifiers it may take, its embedding. What private documents said goes.
 */
export const enrichSubject = async (
  tx: SubjectTransaction,
  attachment: Attachment,
  mention: SubjectMention,
  everySubject: readonly Subject[],
  {
    origin,
    embedding,
  }: { readonly origin: SubjectOrigin; readonly embedding: Embedding | undefined },
): Promise<void> => {
  if (origin.private) return;
  const { subject } = attachment;
  if (!subject.private) {
    await enrichPublic(tx, attachment, mention, everySubject);
    return;
  }
  await replaceSubjectIdentity(
    tx,
    subject.id,
    {
      canonicalName: mention.name,
      aliases: [],
      identifiers: subjectIdentifiersFor(
        { ...subject, identifiers: [] },
        everySubject,
        mention.identifiers,
      ),
      private: false,
    },
    embedding,
  );
};
