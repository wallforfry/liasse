import { screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeServer, json, renderApp } from '../../test/render.test-helper.tsx';

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

  it('corrects the type with one chosen from the registry, found by an alias', async () => {
    const types = {
      types: [
        { slug: 'note', aliases: [], description: 'A note.' },
        { slug: 'invoice', aliases: ['bill'], description: 'A bill to pay.' },
      ].map((type) => ({
        ...type,
        parent_slug: null,
        version: 1,
        status: 'stable',
        fields: {},
        document_count: 0,
      })),
    };
    const server = fakeServer(
      (request) => (request.path.startsWith('/types') ? json(types) : undefined),
      (request) =>
        request.path.startsWith('/documents/doc_01HOSTILE') ? json(HOSTILE_DOCUMENT) : undefined,
    );
    renderApp('/documents/doc_01HOSTILE', server.fetch);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Correct' }));
    await user.click(screen.getByRole('combobox', { name: 'Type' }));
    await user.type(screen.getByPlaceholderText('Search the types...'), 'bill');
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
});
