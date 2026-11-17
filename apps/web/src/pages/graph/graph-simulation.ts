import type { GraphEdge, GraphNode } from '@liasse/sdk';
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';

// d3-force moves what it is given: it writes `x`, `y`, `vx`, `vy` on a body and reads
// `fx`, `fy` to hold one in place. These objects are the one mutable state of the view.
export interface Body extends SimulationNodeDatum {
  readonly node: GraphNode;
  readonly radius: number;
}

export interface Spring extends SimulationLinkDatum<Body> {
  readonly edge: GraphEdge;
  readonly source: Body;
  readonly target: Body;
}

export interface Bounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface GraphSimulation {
  readonly simulation: Simulation<Body, Spring>;
  readonly bodies: readonly Body[];
  readonly springs: readonly Spring[];
}

/** What the simulation moves: the bodies of the kinds shown and the springs between them. */
export interface ShownGraph {
  readonly bodies: readonly Body[];
  readonly springs: readonly Spring[];
}

// d3-force's cooling reaches its minimum alpha in about 300 ticks.
export const SETTLED_TICKS = 300;
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

/**
 * A simulation of the graph, stopped after `ticks`: the first paint shows it already
 * near its shape. d3-force starts from a fixed spiral, so the same graph gets the same
 * positions. An edge to a node it was not given is dropped.
 */
export const createGraphSimulation = (
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  ticks: number,
): GraphSimulation => {
  const degree = degrees(edges);
  const bodies: Body[] = nodes.map((node) => ({
    node,
    radius: nodeRadius(node.kind, degree.get(node.id) ?? 0),
  }));
  const byId = new Map(bodies.map((body) => [body.node.id, body]));
  const springs: Spring[] = edges.flatMap((edge) => {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    return source === undefined || target === undefined ? [] : [{ edge, source, target }];
  });
  const simulation = forceSimulation<Body, Spring>(bodies)
    .force('charge', forceManyBody<Body>().strength(-60))
    .force('link', forceLink<Body, Spring>(springs).distance(40))
    .force(
      'collide',
      forceCollide<Body>(({ radius }) => radius + 3),
    )
    .force('x', forceX<Body>().strength(0.04))
    .force('y', forceY<Body>().strength(0.04))
    .stop()
    .tick(ticks);
  return { simulation, bodies, springs };
};

/** The bodies `shown` keeps and the springs between two of them. */
export const shownOf = (
  { bodies, springs }: GraphSimulation,
  shown: (node: GraphNode) => boolean,
): ShownGraph => ({
  bodies: bodies.filter(({ node }) => shown(node)),
  springs: springs.filter(({ source, target }) => shown(source.node) && shown(target.node)),
});

/**
 * Lets the simulation move only these bodies, from where they are. The others stay
 * where they were for when they come back.
 */
export const simulateOnly = (
  simulation: GraphSimulation['simulation'],
  { bodies, springs }: ShownGraph,
): void => {
  simulation.nodes([...bodies]);
  simulation.force<ReturnType<typeof forceLink<Body, Spring>>>('link')?.links([...springs]);
};

/** Where a body stands, as the `transform` of its element. */
export const placeOf = ({ x = 0, y = 0 }: Body): string => `translate(${String(x)} ${String(y)})`;

export const boundsOf = (bodies: readonly Body[]): Bounds => {
  if (bodies.length === 0) {
    return { x: -PADDING, y: -PADDING, width: 2 * PADDING, height: 2 * PADDING };
  }
  const xs = bodies.flatMap(({ x = 0, radius }) => [x - radius, x + radius]);
  const ys = bodies.flatMap(({ y = 0, radius }) => [y - radius, y + radius]);
  const x = Math.min(...xs) - PADDING;
  const y = Math.min(...ys) - PADDING;
  return { x, y, width: Math.max(...xs) + PADDING - x, height: Math.max(...ys) + PADDING - y };
};
