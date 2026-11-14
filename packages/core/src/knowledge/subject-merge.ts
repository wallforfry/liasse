import { ID_PREFIXES, isId } from '../domain/ids.ts';
import { err, ok, type Result } from '../registry/result.ts';
import type { KnowledgeWriteContext } from './context.ts';
import {
  selfSubjectMerge,
  subjectKindMismatch,
  type SubjectMergeError,
  subjectNotFound,
} from './subject-errors.ts';
import { mergeSubjectIdentifiers } from './subject-identifiers.ts';
import { withSubjectLock } from './subject-lock.ts';
import { withSubjectAliases } from './subject-match.ts';
import { rewriteSubjectReferences } from './subject-references.ts';
import {
  absorbSubject,
  findSubjectById,
  type Subject,
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

// Merges the source into the target, all or nothing: the target takes the labels and the
// identifiers of the source, every reference to the source is pointed at the target, and
// the source is deleted. Answers with the target as it is afterwards. Given a transaction
// instead of a database, the merge is part of it and commits or rolls back with it. Two
// subjects a person merges may carry two plates: the target then carries both.
export const mergeSubjects = (
  { db }: KnowledgeWriteContext,
  pair: SubjectPair,
): Promise<Result<Subject, SubjectMergeError>> =>
  withSubjectLock(db, async (tx) => {
    const found = await findMergeableSubjects(tx, pair);
    if (!found.ok) return found;
    const { source, target } = found.value;
    await rewriteSubjectReferences(tx, source.id, target.id);
    return ok(
      await absorbSubject(tx, source.id, target.id, {
        aliases: withSubjectAliases(target, [source.canonicalName, ...source.aliases]),
        identifiers: mergeSubjectIdentifiers(target.identifiers, source.identifiers),
      }),
    );
  });
