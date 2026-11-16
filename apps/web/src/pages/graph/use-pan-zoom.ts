import { type PointerEvent, type RefObject, useEffect, useRef, useState } from 'react';

export interface Viewport {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
}

const IDENTITY: Viewport = { x: 0, y: 0, scale: 1 };
const MIN_SCALE = 0.2;
const MAX_SCALE = 8;
const WHEEL_STEP = 0.0015;

/** The transform of the content group, as an SVG attribute: no inline style, for the CSP. */
export const transformOf = ({ x, y, scale }: Viewport): string =>
  `translate(${String(x)} ${String(y)}) scale(${String(scale)})`;

const clampScale = (scale: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));

/** The scale that keeps `point` (in the units of the view box) under the cursor. */
export const zoomedAt = (
  viewport: Viewport,
  point: { readonly x: number; readonly y: number },
  factor: number,
): Viewport => {
  const scale = clampScale(viewport.scale * factor);
  const ratio = scale / viewport.scale;
  return {
    scale,
    x: point.x - (point.x - viewport.x) * ratio,
    y: point.y - (point.y - viewport.y) * ratio,
  };
};

// A client point in the units of the view box; none while the element is not rendered.
const toViewBox = (svg: SVGSVGElement, clientX: number, clientY: number) => {
  const matrix = svg.getScreenCTM();
  if (matrix === null) return undefined;
  const inverse = matrix.inverse();
  return {
    x: inverse.a * clientX + inverse.c * clientY + inverse.e,
    y: inverse.b * clientX + inverse.d * clientY + inverse.f,
  };
};

/**
 * Drag the background to pan, wheel to zoom at the cursor. The wheel listener is not
 * passive, so that zooming does not scroll the page; React only adds passive ones.
 */
export const usePanZoom = (svgRef: RefObject<SVGSVGElement | null>) => {
  const [viewport, setViewport] = useState<Viewport>(IDENTITY);
  const drag = useRef<{ readonly x: number; readonly y: number } | undefined>(undefined);

  useEffect(() => {
    const svg = svgRef.current;
    if (svg === null) return undefined;
    const onWheel = (event: WheelEvent) => {
      const point = toViewBox(svg, event.clientX, event.clientY);
      if (point === undefined) return;
      event.preventDefault();
      setViewport((current) => zoomedAt(current, point, Math.exp(-event.deltaY * WHEEL_STEP)));
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      svg.removeEventListener('wheel', onWheel);
    };
  }, [svgRef]);

  const handlers = {
    onPointerDown: (event: PointerEvent<SVGSVGElement>) => {
      if (event.target !== event.currentTarget || svgRef.current === null) return;
      drag.current = toViewBox(svgRef.current, event.clientX, event.clientY);
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: (event: PointerEvent<SVGSVGElement>) => {
      const start = drag.current;
      if (start === undefined || svgRef.current === null) return;
      const point = toViewBox(svgRef.current, event.clientX, event.clientY);
      if (point === undefined) return;
      drag.current = point;
      setViewport((current) => ({
        ...current,
        x: current.x + point.x - start.x,
        y: current.y + point.y - start.y,
      }));
    },
    onPointerUp: () => {
      drag.current = undefined;
    },
  };

  return {
    viewport,
    handlers,
    zoomBy: (factor: number, center: { readonly x: number; readonly y: number }) => {
      setViewport((current) => zoomedAt(current, center, factor));
    },
    reset: () => {
      setViewport(IDENTITY);
    },
  };
};
