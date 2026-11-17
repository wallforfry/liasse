import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, onTestFinished } from 'vitest';
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

// jsdom has no `getScreenCTM`: the test gives the canvas a screen.
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
    withScreen();
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
    withScreen();
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

    pressAndMove(contract, { x: 20, y: 30 });
    fireEvent.pointerMove(contract, { clientX: 300, clientY: 300, buttons: 0, pointerId: 7 });
    fireEvent.pointerMove(contract, { clientX: 310, clientY: 310, buttons: 1, pointerId: 7 });
    expect(placeOf(name)).toBe('translate(20 30)');
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

  it('labels documents once zoomed in', async () => {
    renderApp('/graph', fakeServer(graphAnswer).fetch);
    await nodeButton('type energy_contract');
    const labels = () => [...document.querySelectorAll('svg text')].map((text) => text.textContent);
    expect(labels()).not.toContain('Synthetic power contract');

    for (const _ of [1, 2, 3])
      await userEvent.click(screen.getByRole('button', { name: 'Zoom in' }));

    expect(labels()).toContain('Synthetic power contract');
  });

  it('with reduced motion, stands still and moves only the node pulled', async () => {
    withReducedMotion();
    withScreen();
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
