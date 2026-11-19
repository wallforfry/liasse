import { type RefObject, useCallback, useEffect, useRef } from 'react';
import type { Body } from './graph-simulation.ts';
import { LABEL_FONT_SIZE, LABEL_GAP, labelCandidates, placedLabels } from './label-layout.ts';
import type { LiveGraph } from './use-graph-simulation.ts';

export interface LabelPriorities {
  /** The zoom of the content. */
  readonly scale: number;
  /** Labels shown whatever they overlap: the node in focus and its neighbors. */
  readonly forced: ReadonlySet<string> | undefined;
  /** Labels placed before the others: the nodes a search matched. */
  readonly preferred: ReadonlySet<string> | undefined;
}

/**
 * Keeps labels at one size on screen and shows only those that do not overlap. Like the
 * positions, the labels are written in place, at every step of the simulation and every
 * change of zoom or size, off React's render path.
 */
export const useLabelLayout = (
  svgRef: RefObject<SVGSVGElement | null>,
  live: LiveGraph,
  { scale, forced, preferred }: LabelPriorities,
) => {
  const labels = useRef(new Map<Body, SVGTextElement>());
  // The pixels per unit the labels are sized for; none once a label is added.
  const sizedFor = useRef<number | undefined>(undefined);

  const layout = useCallback(() => {
    // Screen pixels per unit of the view box, then of the content; none before layout.
    const pixels = (svgRef.current?.getScreenCTM()?.a ?? 1) * scale;
    const placed = placedLabels(labelCandidates(live.bodies, forced, preferred), pixels);
    const resize = sizedFor.current !== pixels;
    sizedFor.current = pixels;
    for (const [body, element] of labels.current) {
      if (resize) {
        element.setAttribute('font-size', String(LABEL_FONT_SIZE / pixels));
        element.setAttribute('y', String(body.radius + LABEL_GAP / pixels));
      }
      element.setAttribute('display', placed.has(body.node.id) ? 'inline' : 'none');
    }
  }, [svgRef, scale, live.bodies, forced, preferred]);

  useEffect(() => {
    layout();
    return live.onStep(layout);
  }, [live, layout]);

  useEffect(() => {
    const svg = svgRef.current;
    if (svg === null) return undefined;
    const observer = new ResizeObserver(layout);
    observer.observe(svg);
    return () => {
      observer.disconnect();
    };
  }, [svgRef, layout]);

  return useCallback(
    (body: Body) => (element: SVGTextElement | null) => {
      sizedFor.current = undefined;
      if (element === null) labels.current.delete(body);
      else labels.current.set(body, element);
    },
    [],
  );
};
