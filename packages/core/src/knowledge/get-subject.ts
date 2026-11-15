import {
  type GetSubjectInput,
  getSubjectInputSchema,
  type GetSubjectOutput,
} from '@liasse/contract';
import {
  MAX_SUBJECT_DOCUMENTS,
  MAX_SUBJECT_NEXT_DATES,
  MAX_SUBJECT_SUGGESTIONS,
} from '@liasse/contract/domain';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { documents } from '../db/schema/documents.ts';
import { docTypes } from '../db/schema/registry.ts';
import { ID_PREFIXES, isId } from '../domain/ids.ts';
import type { KnowledgeReadContext } from './context.ts';
import { statedDocumentDate } from './document-day.ts';
import { effectiveState, holdsId, visibleDocument, visibleSubjectIds } from './read-shared.ts';
import { designatedBy, loadVisibleSubjects, shownTo } from './subject-designation.ts';
import { viewSubjectIdentifier } from './subject-identifiers.ts';
import { deriveSubjectState, readSubjectDocumentStates } from './subject-state.ts';
import { findSubjectById, type Subject } from './subject-store.ts';
import { upcoming } from './upcoming.ts';

const LAST_DAY = '9999-12-31';

const today = (): string => new Date().toISOString().slice(0, 10);

const toRef = ({ id, kind, canonicalName }: Subject) => ({ id, kind, name: canonicalName });

const findByQuery = async (
  db: Database,
  query: string,
  includePrivate: boolean,
): Promise<readonly Subject[]> =>
  designatedBy(await loadVisibleSubjects(db, includePrivate), query);

// An id that is not well-formed names no subject, and is never sent to the database.
const findById = async (
  db: Database,
  id: string,
  includePrivate: boolean,
): Promise<readonly Subject[]> => {
  const subject = isId(ID_PREFIXES.subject, id) ? await findSubjectById(db, id) : undefined;
  if (subject === undefined) return [];
  const visible = await visibleSubjectIds(db, includePrivate, [id]);
  return shownTo(visible, includePrivate)(subject) ? [subject] : [];
};

/**
 * A subject with the documents that concern it, its current state and its next dates.
 * A query that names one subject answers like its id; one that names none, or several,
 * answers with the subjects it may have meant and no details. A subject that no visible
 * document concerns is not found: all that is known of it came from documents the caller
 * may not see.
 */
export const getSubject = async (
  { db }: KnowledgeReadContext,
  input: GetSubjectInput,
): Promise<GetSubjectOutput> => {
  const { id, query, asOf, includePrivate } = getSubjectInputSchema.parse(input);
  const designated =
    id === undefined
      ? await findByQuery(db, query ?? '', includePrivate)
      : await findById(db, id, includePrivate);
  const [found] = designated;
  if (found === undefined || designated.length > 1) {
    return { found: false, suggestions: designated.slice(0, MAX_SUBJECT_SUGGESTIONS).map(toRef) };
  }
  const visible = visibleDocument(includePrivate);
  const ofSubject = and(holdsId(documents.subjectIds, found.id), visible);
  const [listed, documentCount, states, next] = await Promise.all([
    db
      .select({
        id: documents.id,
        title: documents.title,
        type: docTypes.slug,
        date: statedDocumentDate,
        state: effectiveState,
      })
      .from(documents)
      .leftJoin(docTypes, eq(docTypes.id, documents.typeId))
      .where(ofSubject)
      .orderBy(sql`${statedDocumentDate} DESC NULLS LAST`, desc(documents.id))
      .limit(MAX_SUBJECT_DOCUMENTS),
    db.$count(documents, ofSubject),
    readSubjectDocumentStates(db, found.id, visible),
    upcoming(
      { db },
      {
        from: asOf ?? today(),
        to: LAST_DAY,
        subject: found.id,
        includePrivate,
        limit: MAX_SUBJECT_NEXT_DATES,
      },
    ),
  ]);
  return {
    found: true,
    subject: {
      id: found.id,
      kind: found.kind,
      name: found.canonicalName,
      aliases: found.aliases,
      identifiers: found.identifiers.map(viewSubjectIdentifier),
    },
    state: deriveSubjectState(found.kind, states),
    documents: listed,
    document_count: documentCount,
    next_dates: next.dates,
  };
};
