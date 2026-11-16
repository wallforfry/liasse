import { screen, waitFor } from '@testing-library/react';
import { type UserEvent, userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  type Answer,
  errorBody,
  fakeServer,
  json,
  renderApp,
} from '../../test/render.test-helper.tsx';

const MARKUP = '<img src=x onerror="alert(1)"><b>bold</b>';

// A document whose every text part tries to inject markup, as a hostile file could.
const HOSTILE_DOCUMENT = {
  id: 'doc_01HOSTILE',
  status: 'needs_review',
  state: 'current',
  type: 'note',
  title: `Title ${MARKUP}`,
  summary: `Summary ${MARKUP}`,
  mime: 'image/png',
  original_name: 'note.png',
  source: 'api',
  private: true,
  confidence: 0.4,
  error: null,
  core: { issuer: `Issuer ${MARKUP}` },
  ingested_at: '2026-11-15T10:00:00.000Z',
  updated_at: '2026-11-15T10:00:00.000Z',
  schema_version: 1,
  hint: null,
  fields: { note: `Field ${MARKUP}` },
  text: { content: `Text ${MARKUP}`, offset: 0, total_length: 60, has_more: false },
};

// Each type is found by one search term only: `bill` by an alias, `payment` by a description.
const TYPES = {
  types: [
    { slug: 'note', aliases: [], description: 'A note.' },
    { slug: 'invoice', aliases: ['bill'], description: 'A request for payment.' },
  ].map((type) => ({
    ...type,
    parent_slug: null,
    version: 1,
    status: 'stable',
    fields: {},
    document_count: 0,
  })),
};

const answerDocument: Answer = (request) =>
  request.path.startsWith('/documents/doc_01HOSTILE') ? json(HOSTILE_DOCUMENT) : undefined;

const openTypePicker = async (user: UserEvent): Promise<HTMLElement> => {
  await user.click(await screen.findByRole('button', { name: 'Edit by hand' }));
  await user.click(screen.getByRole('combobox', { name: 'Type' }));
  return screen.getByPlaceholderText('Search the types...');
};

describe('the document page', () => {
  it('renders markup read from a document as text, never as elements', async () => {
    const server = fakeServer((request) =>
      request.path.startsWith('/documents/doc_01HOSTILE') ? json(HOSTILE_DOCUMENT) : undefined,
    );
    const { container } = renderApp('/documents/doc_01HOSTILE', server.fetch);
    expect(await screen.findByRole('heading', { name: `Title ${MARKUP}` })).toBeInTheDocument();
    expect(screen.getByText(`Summary ${MARKUP}`)).toBeInTheDocument();
    expect(screen.getByText(`Issuer ${MARKUP}`)).toBeInTheDocument();
    expect(screen.getByText(`Field ${MARKUP}`)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Text' }));
    expect(await screen.findByText(`Text ${MARKUP}`)).toBeInTheDocument();
    expect(container.querySelector('b')).toBeNull();
    expect(container.querySelector('img[src="x"]')).toBeNull();
  });

  it('corrects the type with one chosen from the registry, found by alias or description', async () => {
    const server = fakeServer(
      (request) => (request.path.startsWith('/types') ? json(TYPES) : undefined),
      answerDocument,
    );
    renderApp('/documents/doc_01HOSTILE', server.fetch);
    const user = userEvent.setup();
    const search = await openTypePicker(user);
    await user.type(search, 'payment');
    expect(await screen.findByRole('option', { name: /^invoice/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /^note/ })).toBeNull();
    await user.clear(search);
    await user.type(search, 'bill');
    expect(screen.queryByRole('option', { name: /^note/ })).toBeNull();
    await user.click(await screen.findByRole('option', { name: /^invoice/ }));
    expect(screen.getByRole('combobox', { name: 'Type' })).toHaveTextContent('invoice');
    await user.click(screen.getByRole('button', { name: 'Save the correction' }));
    await waitFor(() => {
      expect(server.requests.find(({ method }) => method === 'PATCH')?.body).toBe(
        JSON.stringify({ type: 'invoice' }),
      );
    });
  });

  it('says why the types could not be listed', async () => {
    const server = fakeServer(
      (request) =>
        request.path.startsWith('/types')
          ? errorBody(503, 'unavailable', 'The registry cannot be read.')
          : undefined,
      answerDocument,
    );
    renderApp('/documents/doc_01HOSTILE', server.fetch);
    await openTypePicker(userEvent.setup());
    expect(await screen.findByText('The registry cannot be read.')).toBeInTheDocument();
  });

  it('offers to retry a failed document only, and reads it again once queued', async () => {
    const failed = { ...HOSTILE_DOCUMENT, status: 'failed', error: 'model_provider_failed' };
    const views = [failed, { ...failed, status: 'received', error: null }];
    const server = fakeServer((request) => {
      if (request.method === 'POST' && request.path === '/documents/doc_01HOSTILE/retry') {
        views.shift();
        return json(views[0], 202);
      }
      return request.path.startsWith('/documents/doc_01HOSTILE') ? json(views[0]) : undefined;
    });
    renderApp('/documents/doc_01HOSTILE', server.fetch);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    });
    expect(screen.getAllByText('received').length).toBeGreaterThan(0);
  });

  it('offers no retry for a document that did not fail', async () => {
    const server = fakeServer(answerDocument);
    renderApp('/documents/doc_01HOSTILE', server.fetch);
    expect(await screen.findByRole('button', { name: 'Delete' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('shows a PNG original inline from the file route', async () => {
    const server = fakeServer((request) =>
      request.path.startsWith('/documents/doc_01HOSTILE') ? json(HOSTILE_DOCUMENT) : undefined,
    );
    renderApp('/documents/doc_01HOSTILE', server.fetch);
    await userEvent.setup().click(await screen.findByRole('tab', { name: 'File' }));
    expect(await screen.findByRole('img', { name: 'The original image' })).toHaveAttribute(
      'src',
      '/documents/doc_01HOSTILE/file',
    );
  });

  it('shows the processing log oldest first, with the code, provider answer and attempt of each failure', async () => {
    const failure = {
      id: 'evt_02',
      occurred_at: '2026-11-15T10:05:00.000Z',
      stage: 'extraction',
      outcome: 'failed',
      status: 'failed',
      attempt: 3,
      max_attempts: 3,
      error_code: 'model_provider_failed',
      error_name: 'ModelProviderError',
      http_status: 400,
      provider_code: 'invalid_request_error:invalid_json_schema',
      retryable: true,
      model: 'synthetic-model',
      details: {},
    };
    const success = {
      ...failure,
      id: 'evt_01',
      occurred_at: '2026-11-15T10:01:00.000Z',
      stage: 'text',
      outcome: 'succeeded',
      status: 'extracted',
      attempt: null,
      max_attempts: null,
      error_code: null,
      error_name: null,
      http_status: null,
      provider_code: null,
      retryable: null,
      model: null,
      details: { text_method: 'native', pages: 2, rejected_values: 1 },
    };
    const server = fakeServer(
      (request) =>
        request.path === '/documents/doc_01HOSTILE/events'
          ? json({ events: [success, failure] })
          : undefined,
      answerDocument,
    );
    renderApp('/documents/doc_01HOSTILE', server.fetch);
    await userEvent.setup().click(await screen.findByRole('tab', { name: 'Processing' }));
    expect(await screen.findByText('model_provider_failed')).toBeInTheDocument();
    expect(
      screen.getByText('HTTP 400, invalid_request_error:invalid_json_schema'),
    ).toBeInTheDocument();
    expect(screen.getByText('3 of 3')).toBeInTheDocument();
    expect(screen.getByText('native text, 2 pages, 1 rejected value')).toBeInTheDocument();
    const rows = screen.getAllByRole('row').map((row) => row.textContent);
    expect(rows.findIndex((row) => row.includes('succeeded'))).toBeLessThan(
      rows.findIndex((row) => row.includes('failed')),
    );
  });

  it('says why the processing log could not be read', async () => {
    const server = fakeServer(
      (request) =>
        request.path === '/documents/doc_01HOSTILE/events'
          ? errorBody(503, 'unavailable', 'The log cannot be read.')
          : undefined,
      answerDocument,
    );
    renderApp('/documents/doc_01HOSTILE', server.fetch);
    await userEvent.setup().click(await screen.findByRole('tab', { name: 'Processing' }));
    expect(await screen.findByText('The log cannot be read.')).toBeInTheDocument();
  });
});
