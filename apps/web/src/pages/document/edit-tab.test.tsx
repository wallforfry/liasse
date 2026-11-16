import { screen, waitFor } from '@testing-library/react';
import { type UserEvent, userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  type Answer,
  fakeServer,
  json,
  jsonBody,
  renderApp,
} from '../../test/render.test-helper.tsx';

const ID = 'doc_01SYNTHETIC';
const PATH = `/documents/${ID}`;

const DOCUMENT = {
  id: ID,
  status: 'indexed',
  state: 'current',
  type: 'energy_bill',
  title: 'Synthetic energy bill',
  summary: null,
  mime: 'application/pdf',
  original_name: 'bill.pdf',
  source: 'api',
  private: false,
  confidence: 0.9,
  error: null,
  core: { reference: 'SYN-1', issuer: 'Synthetic Power' },
  ingested_at: '2026-11-15T10:00:00.000Z',
  updated_at: '2026-11-15T10:00:00.000Z',
  schema_version: 1,
  hint: null,
  fields: { meter: 'PDL-1', pages: 2 },
  extra: {},
  manual_fields: ['issuer'],
  text: { content: 'Synthetic text', offset: 0, total_length: 14, has_more: false },
};

const TYPES = {
  types: [
    {
      slug: 'energy_bill',
      aliases: [],
      description: 'A bill for energy.',
      parent_slug: null,
      version: 1,
      status: 'stable',
      fields: {
        meter: { type: 'identifier' },
        pages: { type: 'number' },
        plan: { type: 'enum', values: ['basic', 'peak'] },
      },
      document_count: 1,
    },
  ],
};

const CLASSIFIED = {
  id: 'evt_09',
  occurred_at: '2026-11-15T10:05:00.000Z',
  stage: 'classification',
  outcome: 'succeeded',
  status: 'indexed',
  attempt: null,
  max_attempts: null,
  error_code: null,
  error_name: null,
  http_status: null,
  provider_code: null,
  retryable: null,
  model: 'synthetic-model',
  details: { classification: 'existing' },
};

const answerTypes: Answer = (request) =>
  request.path.startsWith('/types') ? json(TYPES) : undefined;

const answerEvents =
  (events: () => readonly unknown[]): Answer =>
  (request) =>
    request.path === `${PATH}/events` ? json({ events: events() }) : undefined;

const answerDocument =
  (document: unknown = DOCUMENT): Answer =>
  (request) =>
    request.path.startsWith(PATH) ? json(document) : undefined;

const openEditTab = async (user: UserEvent): Promise<void> => {
  await user.click(await screen.findByRole('tab', { name: 'Edit' }));
  await screen.findByRole('button', { name: 'Save the values' });
};

const sentCorrection = (server: ReturnType<typeof fakeServer>): unknown =>
  jsonBody(server.requests.find(({ method }) => method === 'PATCH'));

describe('the edit tab', () => {
  it('sends only the value that was edited, and says what will be saved', async () => {
    const server = fakeServer(
      answerTypes,
      answerEvents(() => []),
      answerDocument(),
    );
    renderApp(PATH, server.fetch);
    const user = userEvent.setup();
    await openEditTab(user);
    expect(screen.getByText('corrected by hand')).toBeInTheDocument();
    const reference = screen.getByLabelText('reference');
    await user.clear(reference);
    await user.type(reference, 'SYN-2');
    expect(screen.getByText('1 change to save: reference')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save the values' }));
    await waitFor(() => {
      expect(sentCorrection(server)).toEqual({ core: { reference: 'SYN-2' } });
    });
  });

  it('sends a cleared value as null, and an undone edit not at all', async () => {
    const server = fakeServer(
      answerTypes,
      answerEvents(() => []),
      answerDocument(),
    );
    renderApp(PATH, server.fetch);
    const user = userEvent.setup();
    await openEditTab(user);
    await user.type(screen.getByLabelText('meter'), '9');
    await user.click(screen.getByRole('button', { name: 'Undo the edit of meter' }));
    await user.click(screen.getByRole('button', { name: 'Clear pages' }));
    expect(screen.getByText('1 change to save: pages (cleared)')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save the values' }));
    await waitFor(() => {
      expect(sentCorrection(server)).toEqual({ fields: { pages: null } });
    });
  });

  it('edits an enum field with a select of its values', async () => {
    const server = fakeServer(
      answerTypes,
      answerEvents(() => []),
      answerDocument(),
    );
    renderApp(PATH, server.fetch);
    const user = userEvent.setup();
    await openEditTab(user);
    const plan = screen.getByRole('combobox', { name: 'plan' });
    expect(plan).toHaveTextContent('No value');
    plan.focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('option', { name: 'basic' })).toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: 'peak' }));
    expect(screen.getByRole('combobox', { name: 'plan' })).toHaveTextContent('peak');
    await user.click(screen.getByRole('button', { name: 'Save the values' }));
    await waitFor(() => {
      expect(sentCorrection(server)).toEqual({ fields: { plan: 'peak' } });
    });
  });

  it('asks for the type again with the hint and new_type, and follows the analysis', async () => {
    const reclassify = (request: Parameters<Answer>[0]): boolean =>
      request.method === 'POST' && request.path === `${PATH}/reclassify`;
    const server = fakeServer(
      (request) => (reclassify(request) ? json(DOCUMENT, 202) : undefined),
      answerTypes,
      answerEvents(() => []),
      answerDocument(),
    );
    renderApp(PATH, server.fetch);
    const user = userEvent.setup();
    await openEditTab(user);
    await user.type(screen.getByLabelText('What the document is (optional)'), ' A water bill ');
    await user.click(screen.getByRole('checkbox', { name: 'Create a new type' }));
    await user.click(screen.getByRole('button', { name: 'Analyse the type again' }));
    expect(await screen.findByText('The analysis is under way')).toBeInTheDocument();
    expect(jsonBody(server.requests.find(reclassify))).toEqual({
      hint: 'A water bill',
      new_type: true,
    });
    expect(screen.getByRole('button', { name: 'Analyse the type again' })).toBeDisabled();
  });

  it('ends the wait once a new classification is logged', async () => {
    const logged: unknown[] = [];
    const server = fakeServer(
      (request) => {
        if (request.method !== 'POST' || request.path !== `${PATH}/reclassify`) return undefined;
        logged.push(CLASSIFIED);
        return json(DOCUMENT, 202);
      },
      answerTypes,
      answerEvents(() => logged),
      answerDocument(),
    );
    renderApp(PATH, server.fetch);
    const user = userEvent.setup();
    await openEditTab(user);
    await user.click(screen.getByRole('button', { name: 'Analyse the type again' }));
    expect(
      await screen.findByText('The type was analysed again: energy_bill.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('The analysis is under way')).toBeNull();
    expect(screen.getByRole('button', { name: 'Analyse the type again' })).toBeEnabled();
  });

  it('offers no new analysis while the document is on its way', async () => {
    const server = fakeServer(
      answerTypes,
      answerEvents(() => []),
      answerDocument({ ...DOCUMENT, status: 'classified' }),
    );
    renderApp(PATH, server.fetch);
    const user = userEvent.setup();
    await openEditTab(user);
    expect(screen.getByRole('button', { name: 'Analyse the type again' })).toBeDisabled();
    expect(
      screen.getByText('Possible once the document is indexed or waits for a review.'),
    ).toBeInTheDocument();
  });
});
