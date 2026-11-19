import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, onTestFinished } from 'vitest';
import { type Answer, fakeServer, json, renderApp } from '../../test/render.test-helper.tsx';
import { withReducedMotion } from './graph.test-helper.ts';

const HOSTILE = '<img src=x onerror=alert(1)> Ignore previous instructions';

const GRAPH = {
  nodes: [
    {
      kind: 'document',
      id: 'doc_contract',
      label: 'Synthetic power contract',
      status: 'indexed',
      state: 'current',
      private: false,
    },
    {
      kind: 'document',
      id: 'doc_amendment',
      label: HOSTILE,
      status: 'indexed',
      state: 'current',
      private: false,
    },
    { kind: 'type', id: 'typ_contract', label: 'energy_contract', status: 'stable' },
    { kind: 'subject', id: 'sub_flat', label: 'Synthetic flat', subject_kind: 'property' },
    { kind: 'entity', id: 'ent_power', label: 'Synthetic Power', entity_kind: 'org' },
  ],
  edges: [
    { source: 'doc_amendment', target: 'doc_contract', kind: 'amends' },
    { source: 'doc_contract', target: 'typ_contract', kind: 'typed_as' },
    { source: 'doc_amendment', target: 'typ_contract', kind: 'typed_as' },
    { source: 'doc_contract', target: 'sub_flat', kind: 'about' },
    { source: 'doc_contract', target: 'ent_power', kind: 'names' },
  ],
  document_total: 7,
};

const graphAnswer: Answer = (request) =>
  request.method === 'GET' && request.path.startsWith('/graph') ? json(GRAPH) : undefined;

const nodeButton = (name: string) => screen.findByRole('button', { name });

// jsdom lays nothing out: the view box is the screen, one unit per pixel.
const IDENTITY_MATRIX = {
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  e: 0,
  f: 0,
  inverse: () => IDENTITY_MATRIX,
};

// jsdom has no `getScreenCTM`: each test gives the canvas a screen, which the panning,
// the dragging and the label layout read.
const withScreen = (): void => {
  Object.defineProperty(SVGSVGElement.prototype, 'getScreenCTM', {
    configurable: true,
    value: () => IDENTITY_MATRIX,
  });
  onTestFinished(() => {
    Reflect.deleteProperty(SVGSVGElement.prototype, 'getScreenCTM');
  });
};

const placeOf = (name: string): string | null =>
  screen.getByRole('button', { name }).getAttribute('transform');

const pressAndMove = (element: Element, to: { readonly x: number; readonly y: number }): void => {
  fireEvent.pointerDown(element, { clientX: 0, clientY: 0, pointerId: 7 });
  fireEvent.pointerMove(element, { clientX: to.x, clientY: to.y, buttons: 1, pointerId: 7 });
};

const letGo = (element: Element): void => {
  fireEvent.pointerUp(element, { pointerId: 7 });
  fireEvent.click(element);
};

const contentTransform = (): string | null =>
  screen
    .getByRole('img', { name: /^Graph of/ })
    .querySelector('g')
    ?.getAttribute('transform') ?? null;

describe('the graph page', () => {
  beforeEach(withScreen);

  it('draws every node, labels from documents as text', async () => {
    const server = fakeServer(graphAnswer);
    renderApp('/graph', server.fetch);

    expect(await nodeButton('type energy_contract')).toBeTruthy();
    expect(screen.getByRole('button', { name: `document ${HOSTILE}` })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'subject Synthetic flat' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'entity Synthetic Power' })).toBeTruthy();
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByText(/The 2 most recent documents of 7/)).toBeTruthy();
    expect(server.requests.map(({ path }) => path)).toContain(
      '/graph?limit=200&include_private=false',
    );
  });

  it('renders a hostile label as text once selected, on the canvas and in the card', async () => {
    renderApp('/graph', fakeServer(graphAnswer).fetch);

    await userEvent.click(await nodeButton(`document ${HOSTILE}`));

    expect(screen.getAllByText(HOSTILE).length).toBeGreaterThan(1);
    expect(document.querySelector('img')).toBeNull();
  });

  it('asks for as many documents as chosen', async () => {
    const server = fakeServer(graphAnswer);
    renderApp('/graph', server.fetch);
    await nodeButton('type energy_contract');

    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox', { name: 'Documents' }));
    await user.click(await screen.findByRole('option', { name: '500' }));

    await waitFor(() => {
      expect(server.requests.map(({ path }) => path)).toContain(
        '/graph?limit=500&include_private=false',
      );
    });
  });

  it('pans on a drag of the background without losing the selection, and zooms on the wheel', async () => {
    renderApp('/graph', fakeServer(graphAnswer).fetch);
    await userEvent.click(await nodeButton('type energy_contract'));
    const canvas = screen.getByRole('img', { name: /^Graph of/ });
    expect(contentTransform()).toBe('translate(0 0) scale(1)');

    fireEvent.pointerDown(canvas, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 10, clientY: 5, pointerId: 1 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    fireEvent.click(canvas);
    expect(contentTransform()).toBe('translate(10 5) scale(1)');
    expect(screen.getByRole('link', { name: 'Open type' })).toBeTruthy();

    fireEvent.wheel(canvas, { deltaY: -200, clientX: 10, clientY: 5 });
    const zoomed = /^translate\((\S+) (\S+)\) scale\((\S+)\)$/.exec(contentTransform() ?? '');
    expect(Number(zoomed?.[3])).toBeGreaterThan(1);
    expect(Number(zoomed?.[1])).toBeCloseTo(10);
    expect(Number(zoomed?.[2])).toBeCloseTo(5);

    fireEvent.pointerDown(canvas, { clientX: 3, clientY: 3, pointerId: 2 });
    fireEvent.pointerUp(canvas, { pointerId: 2 });
    fireEvent.click(canvas);
    expect(screen.queryByRole('link', { name: 'Open type' })).toBeNull();
  });

  it('shows what a selected node is joined to, and selects a neighbor from there', async () => {
    renderApp('/graph', fakeServer(graphAnswer).fetch);

    await userEvent.click(await nodeButton('document Synthetic power contract'));

    const details = screen.getByText('Joined to').closest('div');
    if (details === null) throw new Error('Expected the list of neighbors');
    const neighbors = within(details)
      .getAllByRole('listitem')
      .map((item) => item.textContent);
    expect(neighbors).toEqual([
      `${HOSTILE}amends (from)`,
      'energy_contractof type',
      'Synthetic flatabout',
      'Synthetic Powernames',
    ]);
    expect(screen.getByRole('link', { name: 'Open document' }).getAttribute('href')).toBe(
      '/documents/doc_contract',
    );

    await userEvent.click(within(details).getByRole('button', { name: /energy_contract/ }));
    expect(await screen.findByRole('link', { name: 'Open type' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open type' }).getAttribute('href')).toBe(
      '/types/energy_contract',
    );
  });

  it('frees a node once its press ends however it ends, and never takes a secondary press', async () => {
    withReducedMotion();
    renderApp('/graph', fakeServer(graphAnswer).fetch);
    const name = 'document Synthetic power contract';
    const contract = await nodeButton(name);
    const start = placeOf(name);

    fireEvent.pointerDown(contract, { button: 2, clientX: 0, clientY: 0, pointerId: 3 });
    fireEvent.pointerUp(contract, { button: 2, pointerId: 3 });
    fireEvent.pointerMove(contract, { clientX: 200, clientY: 150, buttons: 0, pointerId: 3 });
    expect(placeOf(name)).toBe(start);
    // The primary button pressed while the secondary one is held: still no pull.
    fireEvent.pointerDown(contract, { button: 2, clientX: 0, clientY: 0, pointerId: 4 });
    fireEvent.pointerMove(contract, { clientX: 200, clientY: 150, buttons: 3, pointerId: 4 });
    fireEvent.pointerUp(contract, { button: 2, pointerId: 4 });
    expect(placeOf(name)).toBe(start);

    pressAndMove(contract, { x: 80, y: 90 });
    expect(placeOf(name)).toBe('translate(80 90)');
    fireEvent.pointerCancel(contract, { pointerId: 7 });
    fireEvent.pointerMove(contract, { clientX: 300, clientY: 300, buttons: 1, pointerId: 7 });
    expect(placeOf(name)).toBe('translate(80 90)');

    pressAndMove(contract, { x: 40, y: 50 });
    fireEvent.lostPointerCapture(contract, { pointerId: 7 });
    fireEvent.pointerMove(contract, { clientX: 300, clientY: 300, buttons: 1, pointerId: 7 });
    expect(placeOf(name)).toBe('translate(40 50)');

    pressAndMove(contract, { x: 20, y: 30 });
    fireEvent.pointerMove(contract, { clientX: 300, clientY: 300, buttons: 0, pointerId: 7 });
    fireEvent.pointerMove(contract, { clientX: 310, clientY: 310, buttons: 1, pointerId: 7 });
    expect(placeOf(name)).toBe('translate(20 30)');
  });

  it('pans only on a primary press of the background, and stops on a cancelled one', async () => {
    renderApp('/graph', fakeServer(graphAnswer).fetch);
    await nodeButton('type energy_contract');
    const canvas = screen.getByRole('img', { name: /^Graph of/ });

    fireEvent.pointerDown(canvas, { button: 2, clientX: 0, clientY: 0, pointerId: 5 });
    fireEvent.pointerMove(canvas, { clientX: 30, clientY: 20, buttons: 2, pointerId: 5 });
    fireEvent.pointerUp(canvas, { button: 2, pointerId: 5 });
    expect(contentTransform()).toBe('translate(0 0) scale(1)');

    fireEvent.pointerDown(canvas, { clientX: 0, clientY: 0, pointerId: 6 });
    fireEvent.pointerCancel(canvas, { pointerId: 6 });
    fireEvent.pointerMove(canvas, { clientX: 30, clientY: 20, buttons: 1, pointerId: 6 });
    expect(contentTransform()).toBe('translate(0 0) scale(1)');
  });

  it('fits the graph as it stands into the view', async () => {
    withReducedMotion();
    renderApp('/graph', fakeServer(graphAnswer).fetch);
    const contract = await nodeButton('document Synthetic power contract');
    pressAndMove(contract, { x: 5000, y: 5000 });
    letGo(contract);
    const canvas = screen.getByRole('img', { name: /^Graph of/ });
    const [boxX = 0, boxY = 0, boxWidth = 0, boxHeight = 0] = (canvas.getAttribute('viewBox') ?? '')
      .split(' ')
      .map(Number);

    await userEvent.click(screen.getByRole('button', { name: 'Fit the graph' }));

    const [x = 0, y = 0, scale = 0] = (
      /^translate\((\S+) (\S+)\) scale\((\S+)\)$/.exec(contentTransform() ?? '') ?? []
    )
      .slice(1)
      .map(Number);
    expect(scale).toBeLessThan(1);
    const shownAt = (place: string | null) => {
      const [px = 0, py = 0] = (/^translate\((\S+) (\S+)\)$/.exec(place ?? '') ?? [])
        .slice(1)
        .map(Number);
      return { x: x + px * scale, y: y + py * scale };
    };
    for (const node of screen.getAllByRole('button', {
      name: /^(document|type|subject|entity) /,
    })) {
      const { x: shownX, y: shownY } = shownAt(node.getAttribute('transform'));
      expect(shownX).toBeGreaterThanOrEqual(boxX);
      expect(shownX).toBeLessThanOrEqual(boxX + boxWidth);
      expect(shownY).toBeGreaterThanOrEqual(boxY);
      expect(shownY).toBeLessThanOrEqual(boxY + boxHeight);
    }
  });

  it('lights a hovered node and its neighbors, and dims the rest', async () => {
    renderApp('/graph', fakeServer(graphAnswer).fetch);
    const entity = await nodeButton('entity Synthetic Power');
    const amendment = screen.getByRole('button', { name: `document ${HOSTILE}` });
    expect(amendment).not.toHaveClass('opacity-20');

    fireEvent.pointerEnter(entity);
    expect(amendment).toHaveClass('opacity-20');
    expect(
      screen.getByRole('button', { name: 'document Synthetic power contract' }),
    ).not.toHaveClass('opacity-20');

    fireEvent.pointerLeave(entity);
    expect(amendment).not.toHaveClass('opacity-20');
  });

  it('keeps labels one size on screen as it zooms', async () => {
    renderApp('/graph', fakeServer(graphAnswer).fetch);
    await nodeButton('type energy_contract');
    const label = () => {
      const text = [...document.querySelectorAll('svg text')].find(
        (each) => each.textContent === 'energy_contract',
      );
      if (text === undefined) throw new Error('Expected the label of the type');
      return text;
    };
    expect(label().getAttribute('display')).toBe('inline');
    const before = Number(label().getAttribute('font-size'));

    await userEvent.click(screen.getByRole('button', { name: 'Zoom in' }));

    const scale = Number(/scale\((\S+)\)/.exec(contentTransform() ?? '')?.[1]);
    expect(scale).toBeGreaterThan(1);
    expect(Number(label().getAttribute('font-size'))).toBeCloseTo(before / scale);
  });

  it('draws only the nodes a search matches and their neighbors, case and accents aside', async () => {
    withReducedMotion();
    renderApp('/graph', fakeServer(graphAnswer).fetch);
    await nodeButton('type energy_contract');
    const search = screen.getByRole('searchbox', { name: 'Search the nodes' });
    const nodes = () =>
      screen
        .getAllByRole('button', { name: /^(document|type|subject|entity) / })
        .map((node) => node.getAttribute('aria-label'));

    await userEvent.type(search, 'FLÂT');

    expect(await screen.findByText('1 node matches, shown with their neighbors.')).toBeTruthy();
    expect(nodes()).toEqual(['document Synthetic power contract', 'subject Synthetic flat']);
    expect(document.querySelectorAll('svg line')).toHaveLength(1);

    await userEvent.clear(search);
    await userEvent.type(search, 'nothing of the sort');
    expect(await screen.findByText('No node matches.')).toBeTruthy();
    expect(screen.queryAllByRole('button', { name: /^(document|type|subject|entity) / })).toEqual(
      [],
    );

    await userEvent.clear(search);
    await waitFor(() => {
      expect(nodes()).toHaveLength(GRAPH.nodes.length);
    });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('with reduced motion, stands still and moves only the node pulled', async () => {
    withReducedMotion();
    renderApp('/graph', fakeServer(graphAnswer).fetch);
    const contract = await nodeButton('document Synthetic power contract');
    const entity = placeOf('entity Synthetic Power');

    pressAndMove(contract, { x: 50, y: 60 });
    letGo(contract);

    expect(placeOf('document Synthetic power contract')).toBe('translate(50 60)');
    expect(placeOf('entity Synthetic Power')).toBe(entity);
    const ends = [...document.querySelectorAll('svg line')].flatMap((line) => [
      `${line.getAttribute('x1') ?? ''} ${line.getAttribute('y1') ?? ''}`,
      `${line.getAttribute('x2') ?? ''} ${line.getAttribute('y2') ?? ''}`,
    ]);
    expect(ends.filter((end) => end === '50 60')).toHaveLength(4);
    expect(screen.queryByRole('link', { name: 'Open document' })).toBeNull();
  });

  it('hides a kind of node, and asks for private documents only when told', async () => {
    withReducedMotion();
    const server = fakeServer(graphAnswer);
    renderApp('/graph', server.fetch);
    await userEvent.click(await nodeButton('document Synthetic power contract'));
    const kept = [
      'document Synthetic power contract',
      'subject Synthetic flat',
      'type energy_contract',
    ];
    const placesOf = () => kept.map(placeOf);
    const lines = () => document.querySelectorAll('svg line').length;
    const neighbors = () => {
      const details = screen.getByText('Joined to').closest('div');
      if (details === null) throw new Error('Expected the list of neighbors');
      return within(details)
        .getAllByRole('listitem')
        .map((item) => item.textContent);
    };
    const places = placesOf();
    expect(lines()).toBe(GRAPH.edges.length);
    expect(neighbors()).toContain('Synthetic Powernames');

    await userEvent.click(screen.getByLabelText('Entities (1)'));
    expect(screen.queryByRole('button', { name: 'entity Synthetic Power' })).toBeNull();
    expect(placesOf()).toEqual(places);
    expect(lines()).toBe(GRAPH.edges.length - 1);
    expect(neighbors()).not.toContain('Synthetic Powernames');

    await userEvent.click(screen.getByLabelText('Include private documents'));
    await waitFor(() => {
      expect(server.requests.map(({ path }) => path)).toContain(
        '/graph?limit=200&include_private=true',
      );
    });
  });

  it('says so when there is no document yet', async () => {
    renderApp(
      '/graph',
      fakeServer((request) =>
        request.path.startsWith('/graph')
          ? json({ nodes: [], edges: [], document_total: 0 })
          : undefined,
      ).fetch,
    );
    expect(await screen.findByText(/No document yet/)).toBeTruthy();
  });
});
