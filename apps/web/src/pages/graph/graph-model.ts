import { GRAPH_NODE_KINDS, type GraphNodeKind, LINK_KINDS } from '@liasse/contract/domain';
import type { Graph, GraphEdge, GraphNode } from '@liasse/sdk';

export interface NodeKindStyle {
  readonly label: string;
  /** Classes of the circle of the node, and of its swatch in the legend. */
  readonly fill: string;
  readonly swatch: string;
}

// Typed by the node kinds of the contract: a new kind fails the build here.
export const NODE_KIND_STYLES: Readonly<Record<GraphNodeKind, NodeKindStyle>> = {
  document: { label: 'Documents', fill: 'fill-graph-document', swatch: 'bg-graph-document' },
  type: { label: 'Types', fill: 'fill-graph-type', swatch: 'bg-graph-type' },
  subject: { label: 'Subjects', fill: 'fill-graph-subject', swatch: 'bg-graph-subject' },
  entity: { label: 'Entities', fill: 'fill-graph-entity', swatch: 'bg-graph-entity' },
};

export const ALL_NODE_KINDS: ReadonlySet<GraphNodeKind> = new Set(GRAPH_NODE_KINDS);

const LINKS: ReadonlySet<string> = new Set(LINK_KINDS);

/** A link the text model found between two documents, as opposed to a membership. */
export const isDocumentLink = ({ kind }: GraphEdge): boolean => LINKS.has(kind);

/** The nodes of the kinds shown, and the edges between two of them. */
export const visibleGraph = (
  graph: Graph,
  kinds: ReadonlySet<GraphNodeKind>,
): Pick<Graph, 'nodes' | 'edges'> => {
  const nodes = graph.nodes.filter(({ kind }) => kinds.has(kind));
  const ids = new Set(nodes.map(({ id }) => id));
  return {
    nodes,
    edges: graph.edges.filter(({ source, target }) => ids.has(source) && ids.has(target)),
  };
};

export interface Neighbor {
  readonly node: GraphNode;
  readonly edge: GraphEdge;
  /** Whether the edge goes from the node to its neighbor. */
  readonly outgoing: boolean;
}

/** The nodes one edge away, in the order of the edges. */
export const neighborsOf = (
  id: string,
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): readonly Neighbor[] => {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return edges.flatMap((edge) => {
    const outgoing = edge.source === id;
    if (!outgoing && edge.target !== id) return [];
    const node = byId.get(outgoing ? edge.target : edge.source);
    return node === undefined ? [] : [{ node, edge, outgoing }];
  });
};

/** `replies_to` as `replies to`, and the memberships as a reader says them. */
export const edgeLabel = ({ kind }: GraphEdge, outgoing: boolean): string => {
  switch (kind) {
    case 'typed_as':
      return outgoing ? 'of type' : 'document of this type';
    case 'child_of':
      return outgoing ? 'child of' : 'parent of';
    case 'about':
      return outgoing ? 'about' : 'document about this';
    case 'names':
      return outgoing ? 'names' : 'named by';
    default:
      return outgoing ? kind.replaceAll('_', ' ') : `${kind.replaceAll('_', ' ')} (from)`;
  }
};
