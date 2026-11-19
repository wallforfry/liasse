import type { PointerEvent } from 'react';
import { cn } from '../../lib/utils.ts';
import { NODE_KIND_STYLES } from './graph-model.ts';
import { type Body, placeOf } from './graph-simulation.ts';
import { shortened } from './label-layout.ts';

export interface NodePointerHandlers {
  readonly onPointerDown: (event: PointerEvent<SVGGElement>) => void;
  readonly onPointerMove: (event: PointerEvent<SVGGElement>) => void;
  readonly onPointerUp: () => void;
  readonly onPointerCancel: () => void;
  readonly onLostPointerCapture: () => void;
  readonly onClick: () => void;
}

export interface GraphNodeMarkProps {
  readonly body: Body;
  readonly register: (element: SVGGElement | null) => void;
  readonly selected: boolean;
  readonly dimmed: boolean;
  /** Takes the label, which the label layout sizes, places and shows. */
  readonly registerLabel: (element: SVGTextElement | null) => void;
  readonly onHover: (id: string | undefined) => void;
  readonly onSelect: (id: string) => void;
  readonly pointer: NodePointerHandlers;
}

/** One node: a circle and its label, at the place the simulation gives its body. */
export const GraphNodeMark = ({
  body,
  register,
  selected,
  dimmed,
  registerLabel,
  onHover,
  onSelect,
  pointer,
}: GraphNodeMarkProps) => {
  const { node, radius } = body;
  // Labels are read from documents: rendered as text nodes, never as markup.
  return (
    <g
      ref={register}
      role="button"
      tabIndex={0}
      aria-label={`${node.kind} ${node.label}`}
      aria-pressed={selected}
      className={cn('cursor-pointer outline-none transition-opacity', dimmed && 'opacity-20')}
      transform={placeOf(body)}
      onPointerEnter={() => {
        onHover(node.id);
      }}
      onPointerLeave={() => {
        onHover(undefined);
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onSelect(node.id);
      }}
      {...pointer}
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
      <text
        ref={registerLabel}
        display="none"
        dominantBaseline="hanging"
        textAnchor="middle"
        className="pointer-events-none fill-foreground select-none"
      >
        {shortened(node.label)}
      </text>
    </g>
  );
};
