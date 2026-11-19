import type { Body } from './graph-simulation.ts';

/** The size of a label on screen, in pixels, whatever the zoom. */
export const LABEL_FONT_SIZE = 11;
/** The space between a circle and its label, on screen. */
export const LABEL_GAP = 3;

const LABEL_LENGTH = 32;
// No layout to measure text against before it is drawn: an average Latin glyph is about
// 0.6 em wide in a sans-serif face. A wide script (CJK, full-width forms, about 1 em a
// glyph) is underestimated, so its labels can overlap a little.
const GLYPH_WIDTH = 0.6;
const MARGIN = 2;
const CELL = 64;

export const shortened = (label: string): string =>
  label.length > LABEL_LENGTH ? `${label.slice(0, LABEL_LENGTH - 1)}…` : label;

export interface LabelCandidate {
  readonly id: string;
  /** The centre of the node, in the units of the content. */
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly text: string;
  /** Shown even where it overlaps another label. */
  readonly forced: boolean;
}

/**
 * The labels of `bodies` where they stand, in the order they are placed: the nodes a
 * search matched first, then the larger ones (a type, a subject or an entity before a
 * document, and the most connected first among them).
 */
export const labelCandidates = (
  bodies: readonly Body[],
  forced: ReadonlySet<string> | undefined,
  preferred: ReadonlySet<string> | undefined,
): readonly LabelCandidate[] =>
  bodies
    .toSorted(
      (a, b) =>
        Number(preferred?.has(b.node.id) === true) - Number(preferred?.has(a.node.id) === true) ||
        b.radius - a.radius,
    )
    .map((body) => ({
      id: body.node.id,
      x: body.x ?? 0,
      y: body.y ?? 0,
      radius: body.radius,
      text: shortened(body.node.label),
      forced: forced?.has(body.node.id) === true,
    }));

interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

// The label centred under its circle, in screen pixels.
const boxOf = ({ x, y, radius, text }: LabelCandidate, pixels: number): Box => {
  const width = text.length * GLYPH_WIDTH * LABEL_FONT_SIZE + 2 * MARGIN;
  const top = (y + radius) * pixels + LABEL_GAP;
  return {
    left: x * pixels - width / 2,
    top,
    right: x * pixels + width / 2,
    bottom: top + LABEL_FONT_SIZE + MARGIN,
  };
};

const overlaps = (a: Box, b: Box): boolean =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

const cellsOf = ({ left, top, right, bottom }: Box): readonly string[] => {
  const columns = Array.from(
    { length: Math.floor(right / CELL) - Math.floor(left / CELL) + 1 },
    (_, index) => Math.floor(left / CELL) + index,
  );
  const rows = Array.from(
    { length: Math.floor(bottom / CELL) - Math.floor(top / CELL) + 1 },
    (_, index) => Math.floor(top / CELL) + index,
  );
  return columns.flatMap((column) => rows.map((row) => `${String(column)} ${String(row)}`));
};

/**
 * The ids of the labels that fit, `pixels` being the screen pixels per unit of the
 * content. Labels keep their size on screen, so zooming in spreads the nodes under them
 * and makes room for more. Forced labels come first, then the others in the order given;
 * a label that overlaps one already placed is left out.
 */
export const placedLabels = (
  candidates: readonly LabelCandidate[],
  pixels: number,
): ReadonlySet<string> => {
  const grid = new Map<string, Box[]>();
  const placed = new Set<string>();
  const ordered = [
    ...candidates.filter(({ forced }) => forced),
    ...candidates.filter(({ forced }) => !forced),
  ];
  for (const candidate of ordered) {
    const box = boxOf(candidate, pixels);
    const cells = cellsOf(box);
    const free = cells.every(
      (cell) => !(grid.get(cell) ?? []).some((other) => overlaps(box, other)),
    );
    if (!free && !candidate.forced) continue;
    placed.add(candidate.id);
    for (const cell of cells) grid.set(cell, [...(grid.get(cell) ?? []), box]);
  }
  return placed;
};
