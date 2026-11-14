import { and, inArray, type SQL, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { SubjectRef } from '../contract/knowledge.ts';
import type { Database } from '../db/client.ts';
import { qualified } from '../db/columns.ts';
import { documents, isLiveDocument } from '../db/schema/documents.ts';
import { documentLinks, subjects } from '../db/schema/knowledge.ts';
import type { DocumentState } from '../domain/enums.ts';

// A tombstone is not a document for any reader, and a document flagged `private` is left
// out unless the caller asks for it, as search and queries do.
export const visibleDocument = (includePrivate: boolean): SQL =>
  includePrivate ? sql`${isLiveDocument}` : sql`(${isLiveDocument} AND NOT ${documents.private})`;

const AMENDED = 'amended';
const amended = (column: PgColumn): SQL => qualified(column, AMENDED);

const CURRENT = 'current' satisfies DocumentState;

// The state of a document for a reader. `documents.state` says what the links pointing at
// the document make of it. An amendment has no life of its own: while the document it
// amends is terminated or superseded, so is it. The chain is followed from amendment to
// amended document until one is not current, the ended state first where it forks (the
// states are ordered current, superseded, terminated). The recursion keeps each document
// once, so it ends on a cycle of amendments. A deleted document has no link left, so the
// chain never reaches one.
//
// The anchor reads the outer row, the only `documents` in its scope. The amended document
// is the same table under an alias, whose columns are named with `qualified`: Drizzle
// prints a column given to `sql` bare in the selection of a query over one table.
export const effectiveState = sql<DocumentState>`(
  WITH RECURSIVE chain(id, state) AS (
    SELECT ${documents.id}, ${documents.state}
    UNION
    SELECT ${amended(documents.id)}, ${amended(documents.state)}
    FROM chain
    JOIN ${documentLinks}
      ON ${documentLinks.fromDocumentId} = chain.id AND ${documentLinks.kind} = 'amends'
    JOIN ${documents} AS ${sql.identifier(AMENDED)}
      ON ${amended(documents.id)} = ${documentLinks.toDocumentId}
    WHERE chain.state = ${CURRENT}
  )
  SELECT chain.state FROM chain ORDER BY chain.state DESC LIMIT 1
)`;

export const holdsId = (column: PgColumn, id: string): SQL =>
  sql`${column} @> ARRAY[${id}]::text[]`;

// The subjects of the given ids, by id. An id that no subject has any more is absent.
export const loadSubjectRefs = async (
  db: Database,
  ids: readonly string[],
): Promise<ReadonlyMap<string, SubjectRef>> => {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: subjects.id, kind: subjects.kind, name: subjects.canonicalName })
    .from(subjects)
    .where(inArray(subjects.id, [...new Set(ids)]));
  return new Map(rows.map((row) => [row.id, row]));
};

export const subjectRefsOf = (
  refs: ReadonlyMap<string, SubjectRef>,
  ids: readonly string[],
): readonly SubjectRef[] => ids.flatMap((id) => refs.get(id) ?? []);

// The ids of the subjects at least one visible document concerns. A subject known only
// through private or deleted documents is not shown: its label came from them.
export const visibleSubjectIds = async (
  db: Database,
  includePrivate: boolean,
  among?: readonly string[],
): Promise<ReadonlySet<string>> => {
  if (among?.length === 0) return new Set();
  const listed = sql<string>`listed.subject_id`;
  const rows = await db
    .selectDistinct({ id: listed })
    .from(
      sql`${documents} CROSS JOIN LATERAL unnest(${documents.subjectIds}) AS listed(subject_id)`,
    )
    .where(
      and(
        visibleDocument(includePrivate),
        among === undefined ? undefined : inArray(listed, [...among]),
      ),
    );
  return new Set(rows.map(({ id }) => id));
};
