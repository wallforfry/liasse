import { MinusIcon, PlusIcon, ScanIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../components/ui/button.tsx';
import { cn } from '../../lib/utils.ts';
import { isDocumentLink } from './graph-model.ts';
import { GraphNodeMark } from './graph-node.tsx';
import { type Body, boundsOf, placeOf, type Spring } from './graph-simulation.ts';
import type { LiveGraph } from './use-graph-simulation.ts';
import { useLabelLayout } from './use-label-layout.ts';
import { useNodeDrag } from './use-node-drag.ts';
import { transformOf, usePanZoom } from './use-pan-zoom.ts';

export interface GraphCanvasProps {
  readonly live: LiveGraph;
  readonly selectedId: string | undefined;
  /** The nodes a search matched, labelled before the others; none without a search. */
  readonly matchedIds: ReadonlySet<string> | undefined;
  readonly onSelect: (id: string | undefined) => void;
}

const BUTTON_ZOOM = 1.4;

const springKey = ({ edge }: Spring): string => `${edge.source} ${edge.target} ${edge.kind}`;

// The node in focus and its neighbors; everything else is dimmed while one is in focus.
const neighborhoodOf = (springs: readonly Spring[], focusId: string | undefined) => {
  if (focusId === undefined) return undefined;
  const ids = new Set([focusId]);
  for (const { source, target } of springs) {
    if (source.node.id === focusId) ids.add(target.node.id);
    if (target.node.id === focusId) ids.add(source.node.id);
  }
  return ids;
};

const placeLine = (element: SVGLineElement, { source, target }: Spring): void => {
  element.setAttribute('x1', String(source.x ?? 0));
  element.setAttribute('y1', String(source.y ?? 0));
  element.setAttribute('x2', String(target.x ?? 0));
  element.setAttribute('y2', String(target.y ?? 0));
};

export const GraphCanvas = ({ live, selectedId, matchedIds, onSelect }: GraphCanvasProps) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const { viewport, handlers, panned, toContent, zoomBy, fit } = usePanZoom(svgRef);
  const [hoveredId, setHoveredId] = useState<string | undefined>(undefined);
  const pointerOf = useNodeDrag(live, toContent, onSelect);
  const nodeElements = useRef(new Map<Body, SVGGElement>());
  const lineElements = useRef(new Map<Spring, SVGLineElement>());
  const neighborhood = useMemo(
    () => neighborhoodOf(live.springs, hoveredId ?? selectedId),
    [live.springs, hoveredId, selectedId],
  );
  const labelOf = useLabelLayout(svgRef, live, {
    scale: viewport.scale,
    forced: neighborhood,
    preferred: matchedIds,
  });
  const { bounds } = live;
  const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };

  // Each step of the simulation moves the elements in place: React renders them once,
  // which keeps a thousand nodes in motion off its render path.
  useEffect(
    () =>
      live.onStep(() => {
        for (const [body, element] of nodeElements.current) {
          element.setAttribute('transform', placeOf(body));
        }
        for (const [spring, element] of lineElements.current) placeLine(element, spring);
      }),
    [live],
  );

  const inFocus = (id: string): boolean => neighborhood === undefined || neighborhood.has(id);

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
            {live.springs.map((spring) => (
              <line
                key={springKey(spring)}
                ref={(element) => {
                  if (element === null) lineElements.current.delete(spring);
                  else lineElements.current.set(spring, element);
                }}
                x1={spring.source.x ?? 0}
                y1={spring.source.y ?? 0}
                x2={spring.target.x ?? 0}
                y2={spring.target.y ?? 0}
                strokeWidth={isDocumentLink(spring.edge) ? 1.5 : 0.75}
                className={cn(
                  'transition-opacity',
                  isDocumentLink(spring.edge)
                    ? 'stroke-foreground/60'
                    : 'stroke-muted-foreground/30',
                  !(inFocus(spring.source.node.id) && inFocus(spring.target.node.id)) &&
                    'opacity-10',
                )}
              />
            ))}
          </g>
          {live.bodies.map((body) => (
            <GraphNodeMark
              key={body.node.id}
              body={body}
              register={(element) => {
                if (element === null) nodeElements.current.delete(body);
                else nodeElements.current.set(body, element);
              }}
              selected={body.node.id === selectedId}
              dimmed={!inFocus(body.node.id)}
              registerLabel={labelOf(body)}
              onHover={setHoveredId}
              onSelect={onSelect}
              pointer={pointerOf(body)}
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
        <Button
          variant="outline"
          size="icon"
          aria-label="Fit the graph"
          onClick={() => {
            fit(bounds, boundsOf(live.bodies));
          }}
        >
          <ScanIcon />
        </Button>
      </div>
    </div>
  );
};
