import { useRef } from 'react';
import type { NodePointerHandlers } from './graph-node.tsx';
import type { Body } from './graph-simulation.ts';
import type { LiveGraph } from './use-graph-simulation.ts';

// A press that moves less than this, in pixels, is a click.
const CLICK_SLOP = 3;
const PRIMARY_BUTTON = 0;
const PRIMARY_BUTTONS_BIT = 1;

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
 * Press a node with the primary button and move to pull it: the simulation holds it under
 * the pointer and its neighbors follow. Whatever ends the press frees it: the button
 * let go, a cancelled touch, a lost capture. A press that does not move selects.
 */
export const useNodeDrag = (
  live: Pick<LiveGraph, 'dragTo' | 'release'>,
  toContent: ToContent,
  onSelect: (id: string) => void,
): ((body: Body) => NodePointerHandlers) => {
  const press = useRef<Press | undefined>(undefined);
  // The node whose press just ended in a pull: the click that follows it selects nothing.
  const pulledLast = useRef<Body | undefined>(undefined);

  const end = (body: Body): void => {
    const current = press.current;
    if (current?.body !== body) return;
    press.current = undefined;
    if (current.moved) live.release(body);
  };

  return (body) => ({
    onPointerDown: (event) => {
      if (event.button !== PRIMARY_BUTTON) return;
      // The background pans on its own presses: this one is the node's.
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      press.current = { body, clientX: event.clientX, clientY: event.clientY, moved: false };
      pulledLast.current = undefined;
    },
    onPointerMove: (event) => {
      const current = press.current;
      if (current?.body !== body) return;
      // A release the node did not see, outside the window for one: the press is over.
      if ((event.buttons & PRIMARY_BUTTONS_BIT) === 0) {
        end(body);
        return;
      }
      const distance = Math.hypot(event.clientX - current.clientX, event.clientY - current.clientY);
      if (!current.moved && distance < CLICK_SLOP) return;
      press.current = { ...current, moved: true };
      const point = toContent(event.clientX, event.clientY);
      if (point !== undefined) live.dragTo(body, point.x, point.y);
    },
    onPointerUp: () => {
      pulledLast.current = press.current?.body === body && press.current.moved ? body : undefined;
      end(body);
    },
    onPointerCancel: () => {
      end(body);
    },
    onLostPointerCapture: () => {
      end(body);
    },
    onClick: () => {
      const wasPulled = pulledLast.current === body;
      pulledLast.current = undefined;
      if (!wasPulled) onSelect(body.node.id);
    },
  });
};
