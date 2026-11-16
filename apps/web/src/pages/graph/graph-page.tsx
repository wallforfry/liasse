import {
  DEFAULT_GRAPH_DOCUMENT_LIMIT,
  GRAPH_NODE_KINDS,
  type GraphNodeKind,
} from '@liasse/contract/domain';
import type { Graph } from '@liasse/sdk';
import { useMemo, useState } from 'react';
import { ErrorAlert } from '../../components/error-alert.tsx';
import { PageHeader } from '../../components/page-header.tsx';
import { Checkbox } from '../../components/ui/checkbox.tsx';
import { Label } from '../../components/ui/label.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.tsx';
import { Skeleton } from '../../components/ui/skeleton.tsx';
import { plural } from '../../lib/format.ts';
import { GraphCanvas } from './graph-canvas.tsx';
import { keptLayout, layoutGraph } from './graph-layout.ts';
import { ALL_NODE_KINDS, neighborsOf, NODE_KIND_STYLES, visibleGraph } from './graph-model.ts';
import { useGraph } from './graph-query.ts';
import { NodeDetails } from './node-details.tsx';

const LIMITS = [100, DEFAULT_GRAPH_DOCUMENT_LIMIT, 500, 1000] as const;

const toggled = (
  kinds: ReadonlySet<GraphNodeKind>,
  kind: GraphNodeKind,
  shown: boolean,
): ReadonlySet<GraphNodeKind> =>
  new Set(GRAPH_NODE_KINDS.filter((each) => (each === kind ? shown : kinds.has(each))));

const KindFilters = ({
  graph,
  kinds,
  onChange,
}: {
  readonly graph: Graph;
  readonly kinds: ReadonlySet<GraphNodeKind>;
  readonly onChange: (kinds: ReadonlySet<GraphNodeKind>) => void;
}) => (
  <fieldset className="flex flex-wrap items-center gap-4">
    <legend className="sr-only">Kinds of node shown</legend>
    {GRAPH_NODE_KINDS.map((kind) => (
      <div key={kind} className="flex items-center gap-2">
        <Checkbox
          id={`graph-kind-${kind}`}
          checked={kinds.has(kind)}
          onCheckedChange={(checked) => {
            onChange(toggled(kinds, kind, checked === true));
          }}
        />
        <span aria-hidden className={`size-2.5 rounded-full ${NODE_KIND_STYLES[kind].swatch}`} />
        <Label htmlFor={`graph-kind-${kind}`}>
          {NODE_KIND_STYLES[kind].label} ({graph.nodes.filter((node) => node.kind === kind).length})
        </Label>
      </div>
    ))}
  </fieldset>
);

const GraphView = ({ graph }: { readonly graph: Graph }) => {
  const [kinds, setKinds] = useState<ReadonlySet<GraphNodeKind>>(ALL_NODE_KINDS);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  // Laid out once with every kind, so hiding one leaves the others where they are.
  const fullLayout = useMemo(() => layoutGraph(graph.nodes, graph.edges), [graph]);
  const visible = useMemo(() => visibleGraph(graph, kinds), [graph, kinds]);
  const layout = useMemo(
    () => keptLayout(fullLayout, ({ kind }) => kinds.has(kind)),
    [fullLayout, kinds],
  );
  const selected = visible.nodes.find(({ id }) => id === selectedId);
  const shown = graph.nodes.filter(({ kind }) => kind === 'document').length;

  return (
    <>
      <KindFilters graph={graph} kinds={kinds} onChange={setKinds} />
      <p className="text-sm text-muted-foreground">
        {shown < graph.document_total
          ? `The ${plural(shown, 'most recent document')} of ${String(graph.document_total)}.`
          : `${plural(shown, 'document')}.`}{' '}
        Drag to pan, scroll to zoom, select a node to see what it is joined to.
      </p>
      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <GraphCanvas layout={layout} selectedId={selected?.id} onSelect={setSelectedId} />
        {selected === undefined ? (
          <p className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
            Select a node of the graph.
          </p>
        ) : (
          <NodeDetails
            node={selected}
            neighbors={neighborsOf(selected.id, visible.nodes, visible.edges)}
            onSelect={setSelectedId}
          />
        )}
      </div>
    </>
  );
};

export const GraphPage = () => {
  const [includePrivate, setIncludePrivate] = useState(false);
  const [limit, setLimit] = useState<number>(DEFAULT_GRAPH_DOCUMENT_LIMIT);
  const graph = useGraph({ limit, includePrivate });
  return (
    <>
      <PageHeader
        title="Graph"
        description="Documents with their types, subjects and the entities they name, and the links found between documents."
      />
      <div className="flex flex-wrap items-center gap-6">
        <div className="flex items-center gap-2">
          <Checkbox
            id="graph-private"
            checked={includePrivate}
            onCheckedChange={(checked) => {
              setIncludePrivate(checked === true);
            }}
          />
          <Label htmlFor="graph-private">Include private documents</Label>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="graph-limit">Documents</Label>
          <Select
            value={String(limit)}
            onValueChange={(next) => {
              setLimit(Number(next));
            }}
          >
            <SelectTrigger id="graph-limit" className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LIMITS.map((each) => (
                <SelectItem key={each} value={String(each)}>
                  {each}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {graph.isPending ? <Skeleton className="h-[70vh] w-full" /> : null}
      {graph.isError ? (
        <ErrorAlert error={graph.error} title="The graph could not be drawn" />
      ) : null}
      {graph.data === undefined ? null : graph.data.nodes.length === 0 ? (
        <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          No document yet: upload one to see the graph grow.
        </p>
      ) : (
        <GraphView graph={graph.data} />
      )}
    </>
  );
};
