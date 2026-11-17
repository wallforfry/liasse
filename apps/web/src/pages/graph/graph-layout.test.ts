import type { GraphEdge, GraphNode } from '@liasse/sdk';
import { describe, expect, it } from 'vitest';
import { layoutGraph, nodeRadius } from './graph-layout.ts';

const documentNode = (id: string): GraphNode => ({
  kind: 'document',
  id,
  label: id,
  status: 'indexed',
  state: 'current',
  private: false,
});

const NODES: readonly GraphNode[] = [
  ...['doc_a', 'doc_b', 'doc_c'].map(documentNode),
  { kind: 'type', id: 'typ_bill', label: 'bill', status: 'stable' },
];
const EDGES: readonly GraphEdge[] = [
  { source: 'doc_a', target: 'typ_bill', kind: 'typed_as' },
  { source: 'doc_b', target: 'typ_bill', kind: 'typed_as' },
  { source: 'doc_c', target: 'doc_a', kind: 'pays' },
  { source: 'doc_c', target: 'sub_hidden', kind: 'about' },
];

describe('layoutGraph', () => {
  it('places every node at a finite point inside the bounds', () => {
    const { nodes, bounds } = layoutGraph(NODES, EDGES);
    expect(nodes.map(({ node }) => node.id)).toEqual(NODES.map(({ id }) => id));
    for (const { x, y } of nodes) {
      expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
      expect(x).toBeGreaterThan(bounds.x);
      expect(x).toBeLessThan(bounds.x + bounds.width);
      expect(y).toBeGreaterThan(bounds.y);
      expect(y).toBeLessThan(bounds.y + bounds.height);
    }
  });

  it('gives the same graph the same layout', () => {
    expect(layoutGraph(NODES, EDGES)).toEqual(layoutGraph(NODES, EDGES));
  });

  it('drops an edge to a node it was not given, and sizes a node by its edges', () => {
    const { nodes, edges } = layoutGraph(NODES, EDGES);
    expect(edges.map(({ edge }) => edge.kind)).toEqual(['typed_as', 'typed_as', 'pays']);
    expect(nodes.find(({ node }) => node.id === 'typ_bill')?.radius).toBe(nodeRadius('type', 2));
    expect(nodeRadius('type', 9)).toBeGreaterThan(nodeRadius('type', 1));
  });

  it('lays out an empty graph', () => {
    expect(layoutGraph([], []).nodes).toEqual([]);
  });
});
