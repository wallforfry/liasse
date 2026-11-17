import type { GraphEdge, GraphNode } from '@liasse/sdk';
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';

export interface PlacedNode {
  readonly node: GraphNode;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

export interface PlacedEdge {
  readonly edge: GraphEdge;
  readonly source: PlacedNode;
  readonly target: PlacedNode;
}

export interface Bounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface GraphLayout {
  readonly nodes: readonly PlacedNode[];
  readonly edges: readonly PlacedEdge[];
  readonly bounds: Bounds;
}

// What d3-force moves: it writes `x`, `y`, `vx` and `vy` on these objects.
interface Body extends SimulationNodeDatum {
  readonly id: string;
  readonly radius: number;
}

// Enough for d3-force's default cooling to settle: alpha falls below its minimum.
const TICKS = 300;
const PADDING = 40;

// A document is one of many; a type, a subject or an entity grows with what it gathers.
export const nodeRadius = (kind: GraphNode['kind'], degree: number): number =>
  kind === 'document' ? 5 : 7 + Math.min(12, Math.sqrt(degree) * 1.5);

const degrees = (edges: readonly GraphEdge[]): ReadonlyMap<string, number> => {
  const counts = new Map<string, number>();
  for (const id of edges.flatMap(({ source, target }) => [source, target])) {
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
};

const boundsOf = (nodes: readonly PlacedNode[]): Bounds => {
  if (nodes.length === 0)
    return { x: -PADDING, y: -PADDING, width: 2 * PADDING, height: 2 * PADDING };
  const xs = nodes.flatMap(({ x, radius }) => [x - radius, x + radius]);
  const ys = nodes.flatMap(({ y, radius }) => [y - radius, y + radius]);
  const x = Math.min(...xs) - PADDING;
  const y = Math.min(...ys) - PADDING;
  return { x, y, width: Math.max(...xs) + PADDING - x, height: Math.max(...ys) + PADDING - y };
};

/**
 * Positions computed once, before the first paint: the graph does not move under the
 * cursor. d3-force starts from a fixed spiral, so the same graph gets the same layout.
 */
export const layoutGraph = (
  nodes: readonly GraphNode[],
  allEdges: readonly GraphEdge[],
): GraphLayout => {
  // forceLink throws on an edge to a node it was not given.
  const ids = new Set(nodes.map(({ id }) => id));
  const edges = allEdges.filter(({ source, target }) => ids.has(source) && ids.has(target));
  const degree = degrees(edges);
  const bodies: Body[] = nodes.map(({ id, kind }) => ({
    id,
    radius: nodeRadius(kind, degree.get(id) ?? 0),
  }));
  const links: SimulationLinkDatum<Body>[] = edges.map(({ source, target }) => ({
    source,
    target,
  }));
  forceSimulation(bodies)
    .force('charge', forceManyBody<Body>().strength(-60))
    .force(
      'link',
      forceLink<Body, SimulationLinkDatum<Body>>(links)
        .id(({ id }) => id)
        .distance(40),
    )
    .force(
      'collide',
      forceCollide<Body>(({ radius }) => radius + 3),
    )
    .force('x', forceX<Body>().strength(0.04))
    .force('y', forceY<Body>().strength(0.04))
    .stop()
    .tick(TICKS);

  const placed = nodes.map((node, index) => {
    const body = bodies[index];
    return {
      node,
      x: body?.x ?? 0,
      y: body?.y ?? 0,
      radius: body?.radius ?? nodeRadius(node.kind, 0),
    };
  });
  const byId = new Map(placed.map((entry) => [entry.node.id, entry]));
  const placedEdges = edges.flatMap((edge) => {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    return source === undefined || target === undefined ? [] : [{ edge, source, target }];
  });
  return { nodes: placed, edges: placedEdges, bounds: boundsOf(placed) };
};

/** The nodes of the layout that `shown` keeps, and the edges between two of them, in place. */
export const keptLayout = (
  layout: GraphLayout,
  shown: (node: GraphNode) => boolean,
): GraphLayout => ({
  ...layout,
  nodes: layout.nodes.filter(({ node }) => shown(node)),
  edges: layout.edges.filter(({ source, target }) => shown(source.node) && shown(target.node)),
});
