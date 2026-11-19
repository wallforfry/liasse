import { describe, expect, it } from 'vitest';
import type { GraphNode } from '@liasse/sdk';
import type { Body } from './graph-simulation.ts';
import { type LabelCandidate, labelCandidates, placedLabels, shortened } from './label-layout.ts';

const label = (id: string, x: number, y: number, forced = false): LabelCandidate => ({
  id,
  x,
  y,
  radius: 5,
  text: `Label ${id}`,
  forced,
});

const documentNode = (id: string): GraphNode => ({
  kind: 'document',
  id,
  label: `Document ${id}`,
  status: 'indexed',
  state: 'current',
  private: false,
});

const body = (node: GraphNode, radius: number): Body => ({ node, radius, x: 0, y: 0 });

describe('labelCandidates', () => {
  const small = body(documentNode('doc_small'), 5);
  const type = body({ kind: 'type', id: 'typ_large', label: 'invoice', status: 'stable' }, 12);
  const larger = body(documentNode('doc_larger'), 9);
  const placed = (candidates: readonly LabelCandidate[]) => [...placedLabels(candidates, 1)];

  it('labels the larger of two nodes that collide', () => {
    expect(
      labelCandidates([small, larger, type], undefined, undefined).map(({ id }) => id),
    ).toEqual(['typ_large', 'doc_larger', 'doc_small']);
    expect(placed(labelCandidates([small, type], undefined, undefined))).toEqual(['typ_large']);
  });

  it('labels a node a search matched before a larger one', () => {
    expect(placed(labelCandidates([type, small], undefined, new Set(['doc_small'])))).toEqual([
      'doc_small',
    ]);
  });

  it('forces only the labels it is told to', () => {
    const candidates = labelCandidates([type, small], new Set(['doc_small']), undefined);
    expect(candidates.map(({ id, forced }) => [id, forced])).toEqual([
      ['typ_large', false],
      ['doc_small', true],
    ]);
    expect(placed(candidates)).toEqual(['doc_small']);
  });
});

describe('placedLabels', () => {
  it('keeps the first of two labels that overlap, and both once zoomed in', () => {
    const close = [label('a', 0, 0), label('b', 10, 4)];

    expect([...placedLabels(close, 1)]).toEqual(['a']);
    expect([...placedLabels(close, 20)]).toEqual(['a', 'b']);
  });

  it('places a forced label before the others, whatever its order', () => {
    expect([...placedLabels([label('a', 0, 0), label('b', 10, 4, true)], 1)]).toEqual(['b']);
  });

  it('shows every forced label, even over another', () => {
    const forced = [label('a', 0, 0, true), label('b', 10, 4, true)];

    expect([...placedLabels(forced, 1)].toSorted()).toEqual(['a', 'b']);
  });

  it('keeps labels that sit apart', () => {
    expect(placedLabels([label('a', 0, 0), label('b', 0, 200), label('c', 400, 0)], 1).size).toBe(
      3,
    );
  });

  it('measures the shortened text', () => {
    const long = 'x'.repeat(80);
    expect(shortened(long)).toHaveLength(32);
    expect(shortened('short')).toBe('short');
  });
});
