import type { GraphNode } from '@liasse/sdk';
import { Link } from 'react-router';
import { PrivateBadge, StatusBadge } from '../../components/document-badges.tsx';
import { Badge } from '../../components/ui/badge.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.tsx';
import { documentPath } from '../../layout/navigation.ts';
import { statusLabel } from '../../lib/format.ts';
import { typePath } from '../types/types-query.ts';
import { edgeLabel, type Neighbor, NODE_KIND_STYLES } from './graph-model.ts';

const KindDot = ({ kind }: { readonly kind: GraphNode['kind'] }) => (
  <span
    aria-hidden
    className={`inline-block size-2.5 shrink-0 rounded-full ${NODE_KIND_STYLES[kind].swatch}`}
  />
);

const Facts = ({ node }: { readonly node: GraphNode }) => {
  switch (node.kind) {
    case 'document':
      return (
        <div className="flex flex-wrap gap-1">
          <StatusBadge status={node.status} />
          <Badge variant="outline">{node.state}</Badge>
          {node.private ? <PrivateBadge /> : null}
        </div>
      );
    case 'type':
      return <Badge variant="outline">{node.status}</Badge>;
    case 'subject':
      return <Badge variant="outline">{statusLabel(node.subject_kind)}</Badge>;
    case 'entity':
      return <Badge variant="outline">{node.entity_kind}</Badge>;
  }
};

const pageOf = (node: GraphNode): string | undefined => {
  if (node.kind === 'document') return documentPath(node.id);
  if (node.kind === 'type') return typePath(node.label);
  return undefined;
};

export interface NodeDetailsProps {
  readonly node: GraphNode;
  readonly neighbors: readonly Neighbor[];
  readonly onSelect: (id: string) => void;
}

/** The selected node and what it is joined to; a neighbor selects it in its turn. */
export const NodeDetails = ({ node, neighbors, onSelect }: NodeDetailsProps) => {
  const page = pageOf(node);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-start gap-2 break-words">
          <span className="mt-1.5">
            <KindDot kind={node.kind} />
          </span>
          <span className="min-w-0">{node.label}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Facts node={node} />
        {page === undefined ? null : (
          <Button asChild size="sm" variant="secondary">
            <Link to={page}>Open {node.kind}</Link>
          </Button>
        )}
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">
            {neighbors.length === 0 ? 'Nothing joined to it here.' : 'Joined to'}
          </p>
          <ul className="max-h-80 space-y-1 overflow-y-auto text-sm">
            {neighbors.map(({ node: neighbor, edge, outgoing }) => (
              <li key={`${edge.source} ${edge.target} ${edge.kind}`}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-accent"
                  onClick={() => {
                    onSelect(neighbor.id);
                  }}
                >
                  <KindDot kind={neighbor.kind} />
                  <span className="min-w-0 flex-1 truncate">{neighbor.label}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {edgeLabel(edge, outgoing)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
};
