import { useRef } from 'react';
import type { NodePointerHandlers } from './graph-node.tsx';
import type { Body } from './graph-simulation.ts';
import type { LiveGraph } from './use-graph-simulation.ts';

// A press that moves less than this, in pixels, is a click.
const CLICK_SLOP = 3;

interface Press {
  readonly body: Body;
  readonly clientX: number;
  readonly clientY: number;
  readonly moved: boolean;
}

type ToContent = (
  clientX: number,
  clientY: number,
) => { readonly x: number; readonly y: number } | undefined;

/**
 * Press a node and move to pull it: the simulation holds it under the pointer and its
 * neighbors follow; once released it is free again. A press that does not move selects.
 */
export const useNodeDrag = (
  live: Pick<LiveGraph, 'dragTo' | 'release'>,
  toContent: ToContent,
  onSelect: (id: string) => void,
): ((body: Body) => NodePointerHandlers) => {
  const press = useRef<Press | undefined>(undefined);
  const pulled = (body: Body): boolean => press.current?.body === body && press.current.moved;

  return (body) => ({
    onPointerDown: (event) => {
      // The background pans on its own presses: this one is the node's.
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      press.current = { body, clientX: event.clientX, clientY: event.clientY, moved: false };
    },
    onPointerMove: (event) => {
      const current = press.current;
      if (current?.body !== body) return;
      const distance = Math.hypot(event.clientX - current.clientX, event.clientY - current.clientY);
      if (!current.moved && distance < CLICK_SLOP) return;
      press.current = { ...current, moved: true };
      const point = toContent(event.clientX, event.clientY);
      if (point !== undefined) live.dragTo(body, point.x, point.y);
    },
    onPointerUp: () => {
      if (pulled(body)) live.release(body);
    },
    onClick: () => {
      const wasPulled = pulled(body);
      press.current = undefined;
      if (!wasPulled) onSelect(body.node.id);
    },
  });
};
