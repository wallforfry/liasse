import {
  type Graph,
  type GraphEdge,
  type GraphNode,
  type GraphRequest,
  graphRequestSchema,
} from '@liasse/contract';
import { liveDocumentStatusSchema } from '@liasse/contract/domain';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { documents, isLiveDocument } from '../db/schema/documents.ts';
import { documentLinks, subjects } from '../db/schema/knowledge.ts';
import { docTypes, entities } from '../db/schema/registry.ts';
import { type DocumentEntity, entitiesNamedByDocuments } from '../entities/references.ts';
import type { ApiContext } from './context.ts';

type Reader = ApiContext['db'];

const unique = (ids: readonly string[]): readonly string[] => [...new Set(ids)];

const readDocuments = async (db: Reader, limit: number, includePrivate: boolean) => {
  const visible = and(isLiveDocument, includePrivate ? undefined : eq(documents.private, false));
  const [rows, total] = await Promise.all([
    db
      .select({
        id: documents.id,
        title: documents.title,
        originalName: documents.originalName,
        status: documents.status,
        state: documents.state,
        private: documents.private,
        typeId: documents.typeId,
        subjectIds: documents.subjectIds,
      })
      .from(documents)
      .where(visible)
      .orderBy(desc(documents.ingestedAt), desc(documents.id))
      .limit(limit),
    db.$count(documents, visible),
  ]);
  return { rows, total };
};

const TYPE_COLUMNS = {
  id: docTypes.id,
  slug: docTypes.slug,
  status: docTypes.status,
  parentSlug: docTypes.parentSlug,
};

// The types of the documents, and the parent of each, so the hierarchy shows. It has
// two levels: a parent has no parent.
const readTypes = async (db: Reader, typeIds: readonly string[]) => {
  if (typeIds.length === 0) return [];
  const own = await db
    .select(TYPE_COLUMNS)
    .from(docTypes)
    .where(inArray(docTypes.id, [...typeIds]));
  const ownSlugs = new Set(own.map(({ slug }) => slug));
  const parentSlugs = unique(
    own.flatMap(({ parentSlug }) =>
      parentSlug === null || ownSlugs.has(parentSlug) ? [] : [parentSlug],
    ),
  );
  const parents =
    parentSlugs.length === 0
      ? []
      : await db
          .select(TYPE_COLUMNS)
          .from(docTypes)
          .where(inArray(docTypes.slug, [...parentSlugs]));
  return [...own, ...parents];
};

const readLinks = async (db: Reader, documentIds: readonly string[]) =>
  documentIds.length === 0
    ? []
    : db
        .select({
          from: documentLinks.fromDocumentId,
          to: documentLinks.toDocumentId,
          kind: documentLinks.kind,
        })
        .from(documentLinks)
        .where(
          and(
            inArray(documentLinks.fromDocumentId, [...documentIds]),
            inArray(documentLinks.toDocumentId, [...documentIds]),
          ),
        );

const readSubjects = async (db: Reader, subjectIds: readonly string[], includePrivate: boolean) =>
  subjectIds.length === 0
    ? []
    : db
        .select({ id: subjects.id, kind: subjects.kind, name: subjects.canonicalName })
        .from(subjects)
        .where(
          and(
            inArray(subjects.id, [...subjectIds]),
            includePrivate ? undefined : eq(subjects.private, false),
          ),
        );

const readEntities = async (db: Reader, entityIds: readonly string[]) =>
  entityIds.length === 0
    ? []
    : db
        .select({ id: entities.id, kind: entities.kind, name: entities.canonicalName })
        .from(entities)
        .where(inArray(entities.id, [...entityIds]));

interface GraphRows {
  readonly documents: Awaited<ReturnType<typeof readDocuments>>['rows'];
  readonly types: Awaited<ReturnType<typeof readTypes>>;
  readonly links: Awaited<ReturnType<typeof readLinks>>;
  readonly subjects: Awaited<ReturnType<typeof readSubjects>>;
  readonly entities: Awaited<ReturnType<typeof readEntities>>;
  readonly named: readonly DocumentEntity[];
}

const toNodes = (rows: GraphRows): readonly GraphNode[] => [
  ...rows.documents.map(({ id, title, originalName, status, state, private: isPrivate }) => ({
    kind: 'document' as const,
    id,
    label: title ?? originalName,
    // Parsed, not asserted: the query holds the tombstone rule, this holds the query to it.
    status: liveDocumentStatusSchema.parse(status),
    state,
    private: isPrivate,
  })),
  ...rows.types.map(({ id, slug, status }) => ({ kind: 'type' as const, id, label: slug, status })),
  ...rows.subjects.map(({ id, kind, name }) => ({
    kind: 'subject' as const,
    id,
    label: name,
    subject_kind: kind,
  })),
  ...rows.entities.map(({ id, kind, name }) => ({
    kind: 'entity' as const,
    id,
    label: name,
    entity_kind: kind,
  })),
];

const toEdges = (rows: GraphRows): readonly GraphEdge[] => {
  const typeIdBySlug = new Map(rows.types.map(({ id, slug }) => [slug, id]));
  return [
    ...rows.links.map(({ from, to, kind }) => ({ source: from, target: to, kind })),
    ...rows.documents.flatMap(({ id, typeId }) =>
      typeId === null ? [] : [{ source: id, target: typeId, kind: 'typed_as' as const }],
    ),
    ...rows.types.flatMap(({ id, parentSlug }) => {
      const parentId = parentSlug === null ? undefined : typeIdBySlug.get(parentSlug);
      return parentId === undefined
        ? []
        : [{ source: id, target: parentId, kind: 'child_of' as const }];
    }),
    ...rows.documents.flatMap(({ id, subjectIds }) =>
      subjectIds.map((subjectId) => ({ source: id, target: subjectId, kind: 'about' as const })),
    ),
    ...rows.named.map(({ documentId, entityId }) => ({
      source: documentId,
      target: entityId,
      kind: 'names' as const,
    })),
  ];
};

/**
 * The most recent documents with their types, subjects and entities, and the edges
 * between them. Labels other than type slugs are read from documents: untrusted content.
 */
export const readGraph = async (
  { db }: Pick<ApiContext, 'db'>,
  request: GraphRequest = {},
): Promise<Graph> => {
  const { limit, include_private } = graphRequestSchema.parse(request);
  const { rows: documentRows, total } = await readDocuments(db, limit, include_private);
  const documentIds = documentRows.map(({ id }) => id);
  const typeIds = unique(documentRows.flatMap(({ typeId }) => (typeId === null ? [] : [typeId])));
  const [types, links, named] = await Promise.all([
    readTypes(db, typeIds),
    readLinks(db, documentIds),
    entitiesNamedByDocuments(db, documentIds),
  ]);
  const subjectIds = unique(documentRows.flatMap(({ subjectIds: ids }) => ids));
  const [subjectRows, entityRows] = await Promise.all([
    readSubjects(db, subjectIds, include_private),
    readEntities(db, unique(named.map(({ entityId }) => entityId))),
  ]);
  const rows: GraphRows = {
    documents: documentRows,
    types,
    links,
    subjects: subjectRows,
    entities: entityRows,
    named,
  };
  const nodes = toNodes(rows);
  // An entity or a subject can be gone, or private, while a document still names it.
  const present = new Set(nodes.map(({ id }) => id));
  const edges = toEdges(rows).filter(
    ({ source, target }) => present.has(source) && present.has(target),
  );
  return { nodes: [...nodes], edges, document_total: total };
};
