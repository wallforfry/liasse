import type { Graph, GraphNode } from '@liasse/sdk';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useMediaQuery } from '../../lib/use-media-query.ts';
import {
  type Body,
  type Bounds,
  boundsOf,
  createGraphSimulation,
  type ShownGraph,
  SETTLED_TICKS,
  shownOf,
  simulateOnly,
} from './graph-simulation.ts';

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';
// In motion, the first paint comes after these ticks and the rest of the cooling plays
// on screen; a change of the kinds shown warms it up again, a drag keeps it warm.
const FIRST_PAINT_TICKS = 60;
const REHEAT_ALPHA = 0.3;
const DRAG_ALPHA_TARGET = 0.3;

export interface LiveGraph extends ShownGraph {
  /** Where the graph stands at its first paint: the view box of the canvas. */
  readonly bounds: Bounds;
  /** Calls `draw` after every step of the simulation; returns how to stop. */
  readonly onStep: (draw: () => void) => () => void;
  readonly dragTo: (body: Body, x: number, y: number) => void;
  readonly release: (body: Body) => void;
}

/**
 * The graph under a live force simulation, as Obsidian draws one. With reduced motion
 * asked for, the simulation is settled before the first paint and only a drag moves
 * a node, alone.
 */
export const useGraphSimulation = (
  graph: Graph,
  shown: (node: GraphNode) => boolean,
): LiveGraph => {
  const reducedMotion = useMediaQuery(REDUCED_MOTION);
  const model = useMemo(
    () =>
      createGraphSimulation(
        graph.nodes,
        graph.edges,
        reducedMotion ? SETTLED_TICKS : FIRST_PAINT_TICKS,
      ),
    [graph, reducedMotion],
  );
  const bounds = useMemo(() => boundsOf(model.bodies), [model]);
  const visible = useMemo(() => shownOf(model, shown), [model, shown]);
  const draws = useRef(new Set<() => void>());
  const drawAll = useCallback(() => {
    for (const draw of draws.current) draw();
  }, []);

  useEffect(() => {
    const { simulation } = model;
    simulateOnly(simulation, visible);
    simulation.on('tick', drawAll);
    if (!reducedMotion) {
      simulation.alpha(Math.max(simulation.alpha(), REHEAT_ALPHA)).restart();
    }
    return () => {
      simulation.stop();
      simulation.on('tick', null);
    };
  }, [model, visible, reducedMotion, drawAll]);

  const onStep = useCallback((draw: () => void) => {
    draws.current.add(draw);
    return () => {
      draws.current.delete(draw);
    };
  }, []);

  const dragTo = useCallback(
    (body: Body, x: number, y: number) => {
      // Under the pointer at once, and held there while the others follow.
      body.fx = x;
      body.fy = y;
      body.x = x;
      body.y = y;
      drawAll();
      if (!reducedMotion) model.simulation.alphaTarget(DRAG_ALPHA_TARGET).restart();
    },
    [model, reducedMotion, drawAll],
  );

  const release = useCallback(
    (body: Body) => {
      body.fx = null;
      body.fy = null;
      if (!reducedMotion) model.simulation.alphaTarget(0);
    },
    [model, reducedMotion],
  );

  return { ...visible, bounds, onStep, dragTo, release };
};
