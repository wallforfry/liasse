import type { GraphEdge } from '@liasse/contract';
import { TOMBSTONE_STATUS } from '@liasse/contract/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { documentLinks, subjects } from '../db/schema/knowledge.ts';
import { docTypes, entities } from '../db/schema/registry.ts';
import { insertSyntheticDocument } from '../testing/fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import { readGraph } from './read-graph.ts';

const edgeOrder = (a: GraphEdge, b: GraphEdge): number =>
  `${a.kind} ${a.source}`.localeCompare(`${b.kind} ${b.source}`);

const inserted = <Row>(rows: readonly Row[]): Row => {
  const [row] = rows;
  if (row === undefined) throw new Error('The synthetic row was not inserted');
  return row;
};

describe('readGraph', () => {
  let database: TestDatabase;
  let ids: Readonly<
    Record<
      | 'parent'
      | 'type'
      | 'vendor'
      | 'insider'
      | 'home'
      | 'hidden'
      | 'contract'
      | 'amendment'
      | 'secret'
      | 'tombstone'
      | 'amendmentName',
      string
    >
  >;

  beforeAll(async () => {
    database = await createTestDatabase();
    const { db } = database;
    const parent = inserted(
      await db.insert(docTypes).values({ slug: 'contract', description: 'Synthetic' }).returning(),
    );
    const type = inserted(
      await db
        .insert(docTypes)
        .values({ slug: 'energy_contract', description: 'Synthetic', parentSlug: 'contract' })
        .returning(),
    );
    const vendor = inserted(
      await db
        .insert(entities)
        .values({ kind: 'org', canonicalName: 'Synthetic Power' })
        .returning(),
    );
    const home = inserted(
      await db
        .insert(subjects)
        .values({ kind: 'property', canonicalName: 'Synthetic flat' })
        .returning(),
    );
    const hidden = inserted(
      await db
        .insert(subjects)
        .values({ kind: 'vehicle', canonicalName: 'Synthetic van', private: true })
        .returning(),
    );
    const insider = inserted(
      await db.insert(entities).values({ kind: 'person', canonicalName: 'Jane Doe' }).returning(),
    );
    const by = { entity_id: vendor.id, match: 'name', confidence: 0.99 };
    const contract = await insertSyntheticDocument(db, {
      title: 'Synthetic contract',
      typeId: type.id,
      subjectIds: [home.id],
      provenance: { issuer: by, parties: [by] },
    });
    const amendment = await insertSyntheticDocument(db, {
      typeId: type.id,
      subjectIds: [home.id, hidden.id],
    });
    const secret = await insertSyntheticDocument(db, {
      private: true,
      subjectIds: [hidden.id],
      provenance: { recipient: { entity_id: insider.id, match: 'name', confidence: 0.99 } },
    });
    const tombstone = await insertSyntheticDocument(db, { status: TOMBSTONE_STATUS });
    await db.insert(documentLinks).values([
      { fromDocumentId: amendment.id, toDocumentId: contract.id, kind: 'amends' },
      { fromDocumentId: secret.id, toDocumentId: contract.id, kind: 'replies_to' },
    ]);
    ids = {
      parent: parent.id,
      type: type.id,
      vendor: vendor.id,
      insider: insider.id,
      home: home.id,
      hidden: hidden.id,
      contract: contract.id,
      amendment: amendment.id,
      secret: secret.id,
      tombstone: tombstone.id,
      amendmentName: amendment.originalName,
    };
  });

  afterAll(async () => {
    await database.dispose();
  });

  it('draws documents, their types with parents, subjects, entities and links', async () => {
    const graph = await readGraph({ db: database.db });
    expect(graph.document_total).toBe(2);
    expect(graph.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'document',
          id: ids.contract,
          label: 'Synthetic contract',
        }),
        expect.objectContaining({ kind: 'document', id: ids.amendment, label: ids.amendmentName }),
        { kind: 'type', id: ids.type, label: 'energy_contract', status: 'provisional' },
        { kind: 'type', id: ids.parent, label: 'contract', status: 'provisional' },
        { kind: 'subject', id: ids.home, label: 'Synthetic flat', subject_kind: 'property' },
        { kind: 'entity', id: ids.vendor, label: 'Synthetic Power', entity_kind: 'org' },
      ]),
    );
    expect(graph.nodes).toHaveLength(6);
    const expected: readonly GraphEdge[] = [
      { source: ids.amendment, target: ids.home, kind: 'about' },
      { source: ids.contract, target: ids.home, kind: 'about' },
      { source: ids.amendment, target: ids.contract, kind: 'amends' },
      { source: ids.type, target: ids.parent, kind: 'child_of' },
      { source: ids.contract, target: ids.vendor, kind: 'names' },
      { source: ids.contract, target: ids.type, kind: 'typed_as' },
      { source: ids.amendment, target: ids.type, kind: 'typed_as' },
    ];
    expect(graph.edges.toSorted(edgeOrder)).toEqual(expected.toSorted(edgeOrder));
  });

  it('shows private documents and subjects only when asked, and never a tombstone', async () => {
    const graph = await readGraph({ db: database.db }, { include_private: true });
    const nodeIds = graph.nodes.map(({ id }) => id);
    expect(graph.document_total).toBe(3);
    expect(nodeIds).toEqual(expect.arrayContaining([ids.secret, ids.hidden, ids.insider]));
    expect(nodeIds).not.toContain(ids.tombstone);
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        { source: ids.secret, target: ids.contract, kind: 'replies_to' },
        { source: ids.secret, target: ids.hidden, kind: 'about' },
        { source: ids.secret, target: ids.insider, kind: 'names' },
      ]),
    );
  });

  it('keeps the most recent documents, and only the links between them', async () => {
    const graph = await readGraph({ db: database.db }, { limit: 1, include_private: true });
    expect(graph.document_total).toBe(3);
    const documentIds = graph.nodes.filter(({ kind }) => kind === 'document').map(({ id }) => id);
    expect(documentIds).toEqual([ids.secret]);
    expect(graph.edges.filter(({ kind }) => kind === 'replies_to')).toEqual([]);
  });
});
