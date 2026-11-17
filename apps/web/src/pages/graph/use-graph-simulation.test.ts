import type { Graph, GraphNode } from '@liasse/sdk';
import { act, renderHook } from '@testing-library/react';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { withReducedMotion } from './graph.test-helper.ts';
import type { Body } from './graph-simulation.ts';

// d3-timer binds the frame scheduler and the clock when it loads: the fake ones must be
// in place first, so nothing that imports d3-force is imported before them. Time then only moves when a test
// moves it, whatever the speed of the machine.
vi.useFakeTimers({
  toFake: [
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'performance',
    'setTimeout',
    'clearTimeout',
    'Date',
  ],
});
const { useGraphSimulation } = await import('./use-graph-simulation.ts');
const { placeOf } = await import('./graph-simulation.ts');

afterAll(() => {
  vi.useRealTimers();
});

const documentNode = (id: string): GraphNode => ({
  kind: 'document',
  id,
  label: id,
  status: 'indexed',
  state: 'current',
  private: false,
});

const GRAPH: Graph = {
  nodes: [
    documentNode('doc_contract'),
    documentNode('doc_amendment'),
    { kind: 'type', id: 'typ_contract', label: 'contract', status: 'stable' },
    { kind: 'entity', id: 'ent_power', label: 'Synthetic Power', entity_kind: 'org' },
  ],
  edges: [
    { source: 'doc_amendment', target: 'doc_contract', kind: 'amends' },
    { source: 'doc_contract', target: 'typ_contract', kind: 'typed_as' },
    { source: 'doc_amendment', target: 'typ_contract', kind: 'typed_as' },
    { source: 'doc_contract', target: 'ent_power', kind: 'names' },
  ],
  document_total: 2,
};

const everything: (node: GraphNode) => boolean = () => true;
const documentsOnly = ({ kind }: GraphNode): boolean => kind === 'document';

const placesOf = (bodies: readonly Body[]): readonly string[] =>
  bodies.map((body) => placeOf(body));

const bodyOf = (bodies: readonly Body[], id: string): Body => {
  const body = bodies.find(({ node }) => node.id === id);
  if (body === undefined) throw new Error(`Expected the body of ${id}`);
  return body;
};

const passes = (milliseconds: number): void => {
  act(() => {
    vi.advanceTimersByTime(milliseconds);
  });
};

// d3-force's cooling ends well within this, at any frame rate the fake scheduler gives.
const UNTIL_AT_REST = 60_000;

const xOf = (body: Body): number => body.x ?? Number.NaN;

describe('useGraphSimulation', () => {
  it('keeps moving into shape, and stops once unmounted', () => {
    const { result, unmount } = renderHook(() => useGraphSimulation(GRAPH, everything));
    const first = placesOf(result.current.bodies);
    passes(200);
    expect(placesOf(result.current.bodies)).not.toEqual(first);

    const { bodies } = result.current;
    unmount();
    const atUnmount = placesOf(bodies);
    passes(2000);
    expect(placesOf(bodies)).toEqual(atUnmount);
  });

  it('stops the simulation of a graph that was replaced', () => {
    const { result, rerender } = renderHook(({ graph }) => useGraphSimulation(graph, everything), {
      initialProps: { graph: GRAPH },
    });
    const old = result.current.bodies;
    rerender({ graph: { ...GRAPH } });
    const atReplace = placesOf(old);
    const fresh = placesOf(result.current.bodies);
    passes(500);
    expect(placesOf(old)).toEqual(atReplace);
    expect(placesOf(result.current.bodies)).not.toEqual(fresh);
  });

  it('comes to rest, and a change of the kinds shown warms it up again', () => {
    const { result, rerender } = renderHook(({ shown }) => useGraphSimulation(GRAPH, shown), {
      initialProps: { shown: everything },
    });
    passes(UNTIL_AT_REST);
    const atRest = placesOf(result.current.bodies);
    passes(2000);
    expect(placesOf(result.current.bodies)).toEqual(atRest);

    rerender({ shown: documentsOnly });
    expect(result.current.bodies.map(({ node }) => node.id)).toEqual([
      'doc_contract',
      'doc_amendment',
    ]);
    const shown = placesOf(result.current.bodies);
    passes(500);
    expect(placesOf(result.current.bodies)).not.toEqual(shown);
  });

  it('holds a pulled body under the pointer while its neighbors follow, then frees it', () => {
    const { result } = renderHook(() => useGraphSimulation(GRAPH, everything));
    passes(UNTIL_AT_REST);
    const contract = bodyOf(result.current.bodies, 'doc_contract');
    const entity = bodyOf(result.current.bodies, 'ent_power');
    const entityBefore = xOf(entity);

    act(() => {
      result.current.dragTo(contract, 400, 300);
    });
    passes(1000);
    expect(placeOf(contract)).toBe('translate(400 300)');
    expect(xOf(entity)).toBeGreaterThan(entityBefore + 100);

    act(() => {
      result.current.release(contract);
    });
    passes(1000);
    expect(placeOf(contract)).not.toBe('translate(400 300)');
  });

  it('with reduced motion, stands still and moves only the body pulled', () => {
    withReducedMotion();
    const { result } = renderHook(() => useGraphSimulation(GRAPH, everything));
    const first = placesOf(result.current.bodies);
    passes(2000);
    expect(placesOf(result.current.bodies)).toEqual(first);

    const contract = bodyOf(result.current.bodies, 'doc_contract');
    act(() => {
      result.current.dragTo(contract, 50, 60);
    });
    passes(2000);
    expect(placesOf(result.current.bodies)).toEqual(
      first.map((place, index) =>
        result.current.bodies[index] === contract ? 'translate(50 60)' : place,
      ),
    );
  });
});
