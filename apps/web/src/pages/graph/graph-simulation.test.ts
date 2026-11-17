import type { GraphEdge, GraphNode } from '@liasse/sdk';
import { describe, expect, it } from 'vitest';
import {
  boundsOf,
  createGraphSimulation,
  nodeRadius,
  placeOf,
  SETTLED_TICKS,
  shownOf,
  simulateOnly,
} from './graph-simulation.ts';

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

const placesOf = (ticks: number) =>
  createGraphSimulation(NODES, EDGES, ticks).bodies.map((body) => placeOf(body));

describe('createGraphSimulation', () => {
  it('places every node at a finite point inside the bounds', () => {
    const { bodies } = createGraphSimulation(NODES, EDGES, SETTLED_TICKS);
    const bounds = boundsOf(bodies);
    expect(bodies.map(({ node }) => node.id)).toEqual(NODES.map(({ id }) => id));
    for (const { x = Number.NaN, y = Number.NaN } of bodies) {
      expect(x).toBeGreaterThan(bounds.x);
      expect(x).toBeLessThan(bounds.x + bounds.width);
      expect(y).toBeGreaterThan(bounds.y);
      expect(y).toBeLessThan(bounds.y + bounds.height);
    }
  });

  it('gives the same graph the same positions, and moves on with more ticks', () => {
    expect(placesOf(SETTLED_TICKS)).toEqual(placesOf(SETTLED_TICKS));
    expect(placesOf(10)).not.toEqual(placesOf(SETTLED_TICKS));
  });

  it('drops an edge to a node it was not given, and sizes a node by its edges', () => {
    const { bodies, springs } = createGraphSimulation(NODES, EDGES, 0);
    expect(springs.map(({ edge }) => edge.kind)).toEqual(['typed_as', 'typed_as', 'pays']);
    expect(bodies.find(({ node }) => node.id === 'typ_bill')?.radius).toBe(nodeRadius('type', 2));
    expect(nodeRadius('type', 9)).toBeGreaterThan(nodeRadius('type', 1));
  });

  it('holds a pinned body where it is pinned', () => {
    const { simulation, bodies } = createGraphSimulation(NODES, EDGES, 0);
    const [pinned] = bodies;
    if (pinned === undefined) throw new Error('Expected a body');
    pinned.fx = 500;
    pinned.fy = -500;
    simulation.tick(20);
    expect(placeOf(pinned)).toBe('translate(500 -500)');
  });
});

describe('shownOf and simulateOnly', () => {
  it('moves only the bodies shown, from where they are, with the springs between them', () => {
    const graph = createGraphSimulation(NODES, EDGES, SETTLED_TICKS);
    const type = graph.bodies.find(({ node }) => node.kind === 'type');
    const before = graph.bodies.map((body) => placeOf(body));

    const shown = shownOf(graph, ({ kind }) => kind === 'document');
    simulateOnly(graph.simulation, shown);

    expect(shown.bodies.map(({ node }) => node.id)).toEqual(['doc_a', 'doc_b', 'doc_c']);
    expect(shown.springs.map(({ edge }) => edge.kind)).toEqual(['pays']);
    expect(graph.bodies.map((body) => placeOf(body))).toEqual(before);
    const typePlace = type === undefined ? undefined : placeOf(type);
    graph.simulation.alpha(1).tick(50);
    expect(type === undefined ? undefined : placeOf(type)).toBe(typePlace);
  });

  it('lays out an empty graph', () => {
    const graph = createGraphSimulation([], [], SETTLED_TICKS);
    expect(shownOf(graph, () => true).bodies).toEqual([]);
    expect(boundsOf([]).width).toBeGreaterThan(0);
  });
});
