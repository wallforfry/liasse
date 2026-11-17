import { MinusIcon, PlusIcon, ScanIcon } from 'lucide-react';
import { useMemo, useRef } from 'react';
import { Button } from '../../components/ui/button.tsx';
import { cn } from '../../lib/utils.ts';
import type { GraphLayout, PlacedNode } from './graph-layout.ts';
import { isDocumentLink, NODE_KIND_STYLES } from './graph-model.ts';
import { transformOf, usePanZoom } from './use-pan-zoom.ts';

export interface GraphCanvasProps {
  readonly layout: GraphLayout;
  readonly selectedId: string | undefined;
  readonly onSelect: (id: string | undefined) => void;
}

const BUTTON_ZOOM = 1.4;
const LABEL_LENGTH = 32;

const shortened = (label: string): string =>
  label.length > LABEL_LENGTH ? `${label.slice(0, LABEL_LENGTH - 1)}…` : label;

// The selected node and its neighbors; everything else is dimmed while one is selected.
const focusOf = (layout: GraphLayout, selectedId: string | undefined) => {
  if (selectedId === undefined) return undefined;
  const ids = new Set([selectedId]);
  for (const { source, target } of layout.edges) {
    if (source.node.id === selectedId) ids.add(target.node.id);
    if (target.node.id === selectedId) ids.add(source.node.id);
  }
  return ids;
};

const NodeMark = ({
  placed,
  selected,
  dimmed,
  labelled,
  onSelect,
}: {
  readonly placed: PlacedNode;
  readonly selected: boolean;
  readonly dimmed: boolean;
  readonly labelled: boolean;
  readonly onSelect: (id: string) => void;
}) => {
  const { node, x, y, radius } = placed;
  // Labels are read from documents: rendered as text nodes, never as markup.
  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={`${node.kind} ${node.label}`}
      aria-pressed={selected}
      className={cn('cursor-pointer outline-none', dimmed && 'opacity-20')}
      transform={`translate(${String(x)} ${String(y)})`}
      onClick={() => {
        onSelect(node.id);
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onSelect(node.id);
      }}
    >
      <title>{node.label}</title>
      <circle
        r={radius}
        className={cn(
          NODE_KIND_STYLES[node.kind].fill,
          'stroke-background',
          selected && 'stroke-foreground',
        )}
        strokeWidth={selected ? 2.5 : 1}
      />
      {labelled ? (
        <text
          y={radius + 11}
          textAnchor="middle"
          className="pointer-events-none fill-foreground text-[10px] select-none"
        >
          {shortened(node.label)}
        </text>
      ) : null}
    </g>
  );
};

export const GraphCanvas = ({ layout, selectedId, onSelect }: GraphCanvasProps) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const { viewport, handlers, panned, zoomBy, reset } = usePanZoom(svgRef);
  const focus = useMemo(() => focusOf(layout, selectedId), [layout, selectedId]);
  const { bounds } = layout;
  const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };

  return (
    <div className="relative overflow-hidden rounded-md border bg-card">
      <svg
        ref={svgRef}
        role="img"
        aria-label="Graph of documents, types, subjects and entities"
        viewBox={`${String(bounds.x)} ${String(bounds.y)} ${String(bounds.width)} ${String(bounds.height)}`}
        className="h-[70vh] w-full cursor-grab touch-none active:cursor-grabbing"
        onClick={(event) => {
          if (event.target === event.currentTarget && !panned()) onSelect(undefined);
        }}
        {...handlers}
      >
        <g transform={transformOf(viewport)}>
          <g className="pointer-events-none">
            {layout.edges.map(({ edge, source, target }) => (
              <line
                key={`${edge.source} ${edge.target} ${edge.kind}`}
                x1={source.x}
                y1={source.y}
                x2={target.x}
                y2={target.y}
                strokeWidth={isDocumentLink(edge) ? 1.5 : 0.75}
                className={cn(
                  isDocumentLink(edge) ? 'stroke-foreground/60' : 'stroke-muted-foreground/30',
                  focus !== undefined &&
                    !(focus.has(source.node.id) && focus.has(target.node.id)) &&
                    'opacity-10',
                )}
              />
            ))}
          </g>
          {layout.nodes.map((placed) => (
            <NodeMark
              key={placed.node.id}
              placed={placed}
              selected={placed.node.id === selectedId}
              dimmed={focus !== undefined && !focus.has(placed.node.id)}
              labelled={placed.node.kind !== 'document' || focus?.has(placed.node.id) === true}
              onSelect={onSelect}
            />
          ))}
        </g>
      </svg>
      <div className="absolute top-2 right-2 flex flex-col gap-1">
        <Button
          variant="outline"
          size="icon"
          aria-label="Zoom in"
          onClick={() => {
            zoomBy(BUTTON_ZOOM, center);
          }}
        >
          <PlusIcon />
        </Button>
        <Button
          variant="outline"
          size="icon"
          aria-label="Zoom out"
          onClick={() => {
            zoomBy(1 / BUTTON_ZOOM, center);
          }}
        >
          <MinusIcon />
        </Button>
        <Button variant="outline" size="icon" aria-label="Fit the graph" onClick={reset}>
          <ScanIcon />
        </Button>
      </div>
    </div>
  );
};
