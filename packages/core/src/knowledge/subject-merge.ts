import { err, ok, type Result } from '@liasse/contract/registry';
import { ID_PREFIXES, isId } from '../domain/ids.ts';
import type { KnowledgeWriteContext } from './context.ts';
import {
  selfSubjectMerge,
  subjectKindMismatch,
  type SubjectMergeError,
  subjectNotFound,
} from './subject-errors.ts';
import { mergeSubjectIdentifiers } from './subject-identifier-rules.ts';
import { withSubjectLock } from './subject-lock.ts';
import { withSubjectAliases } from './subject-match.ts';
import { rewriteSubjectReferences } from './subject-references.ts';
import {
  absorbSubject,
  findSubjectById,
  type MergedEmbedding,
  type Subject,
  type SubjectIdentity,
  type SubjectReader,
} from './subject-store.ts';

export interface SubjectPair {
  readonly sourceId: string;
  readonly targetId: string;
}

interface MergeablePair {
  readonly source: Subject;
  readonly target: Subject;
}

// An id that is not well-formed names no subject, and is never sent to the database.
const findSubject = async (
  reader: SubjectReader,
  id: string,
): Promise<Result<Subject, SubjectMergeError>> => {
  const subject = isId(ID_PREFIXES.subject, id) ? await findSubjectById(reader, id) : undefined;
  return subject === undefined ? err(subjectNotFound(id)) : ok(subject);
};

export const findMergeableSubjects = async (
  reader: SubjectReader,
  { sourceId, targetId }: SubjectPair,
): Promise<Result<MergeablePair, SubjectMergeError>> => {
  if (sourceId === targetId) return err(selfSubjectMerge(sourceId));
  const source = await findSubject(reader, sourceId);
  if (!source.ok) return source;
  const target = await findSubject(reader, targetId);
  if (!target.ok) return target;
  return source.value.kind === target.value.kind
    ? ok({ source: source.value, target: target.value })
    : err(subjectKindMismatch(source.value.kind, target.value.kind));
};

interface MergedSubject {
  readonly identity: SubjectIdentity;
  readonly embedding: MergedEmbedding;
}

// What the merged subject is known by. Two subjects of one standing pool their names,
// and two subjects a person merges may carry two plates: the target then carries both.
// A merged subject is private only when both were, and what only private documents said
// of a private one does not reach a public result: a public subject keeps its own names,
// and a private target takes those of a public source.
const mergedOf = ({ source, target }: MergeablePair): MergedSubject => {
  if (source.private === target.private) {
    return {
      identity: {
        canonicalName: target.canonicalName,
        aliases: withSubjectAliases(target, [source.canonicalName, ...source.aliases]),
        identifiers: mergeSubjectIdentifiers(target.identifiers, source.identifiers),
        private: target.private,
      },
      embedding: 'either',
    };
  }
  const kept = source.private ? target : source;
  return {
    identity: {
      canonicalName: kept.canonicalName,
      aliases: kept.aliases,
      identifiers: kept.identifiers,
      private: false,
    },
    embedding: source.private ? 'target' : 'source',
  };
};

// Merges the source into the target, all or nothing: the target takes the names of the
// merged subject (`mergedOf`), every reference to the source is pointed at the target,
// and the source is deleted. Answers with the target as it is afterwards. Given a
// transaction instead of a database, the merge is part of it and commits or rolls back
// with it.
export const mergeSubjects = (
  { db }: KnowledgeWriteContext,
  pair: SubjectPair,
): Promise<Result<Subject, SubjectMergeError>> =>
  withSubjectLock(db, async (tx) => {
    const found = await findMergeableSubjects(tx, pair);
    if (!found.ok) return found;
    const { source, target } = found.value;
    await rewriteSubjectReferences(tx, source.id, target.id);
    const { identity, embedding } = mergedOf(found.value);
    return ok(await absorbSubject(tx, source.id, target.id, identity, embedding));
  });
