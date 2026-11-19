import { screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeServer, json, jsonBody, renderApp } from '../../test/render.test-helper.tsx';

const reviewed = (name: string, doubtful: boolean) => ({
  section: 'core',
  name,
  confidence: doubtful ? 0.4 : 0.95,
  page: 1,
  quote: `Quote of ${name}`,
  manual: false,
  doubtful,
  confirmable: true,
});

const flagged = (id: string, title: string, analysisPending: boolean) => ({
  id,
  status: 'needs_review',
  state: 'current',
  type: 'note',
  title,
  summary: null,
  mime: 'application/pdf',
  original_name: `${id}.pdf`,
  source: 'api',
  private: false,
  confidence: 0.4,
  error: null,
  ingested_at: '2026-11-15T10:00:00.000Z',
  updated_at: '2026-11-15T10:00:00.000Z',
  schema_version: 1,
  hint: null,
  analysis_pending: analysisPending,
  fields: {},
  core: { issuer: 'Synthetic issuer', reference: 'SYN-1' },
  review: {
    threshold: 0.7,
    reasons: ['low_confidence'],
    rejected_values: 0,
    rejections: [],
    type: { confidence: 0.9, outcome: 'existing', manual: false, doubtful: false, refusal: null },
    values: [reviewed('issuer', true), reviewed('reference', false)],
  },
});

const READY = flagged('doc_synthetic_ready', 'Ready note', false);
const PENDING = flagged('doc_synthetic_pending', 'Pending note', true);
const SETTLED = { ...flagged('doc_synthetic_settled', 'Settled note', false), status: 'indexed' };
const DOCUMENTS = [READY, PENDING];

const queue = (listed: readonly object[] = DOCUMENTS, current = DOCUMENTS) =>
  fakeServer((request) => {
    if (request.path.startsWith('/types')) return json({ types: [] });
    if (request.path.startsWith('/entities')) return json({ entities: [], total: 0 });
    const document = [...current, SETTLED].find(({ id }) =>
      request.path.startsWith(`/documents/${id}`),
    );
    if (document !== undefined) {
      return json(request.method === 'PATCH' ? { ...document, status: 'indexed' } : document);
    }
    if (request.path.startsWith('/documents')) {
      return json({ documents: listed, total: listed.length, has_more: false });
    }
    return undefined;
  });

describe('the bulk acceptance of the review queue', () => {
  it('confirms the doubtful values as read, and refuses a document analysed again', async () => {
    const server = queue();
    renderApp('/review', server.fetch);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('checkbox', { name: 'Select all rows' }));
    expect(screen.queryByRole('button', { name: /Retry failed/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Accept as read (2)' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Accept 2 documents as read?')).toBeInTheDocument();
    expect(server.requests.some(({ method }) => method === 'PATCH')).toBe(false);
    await user.click(within(dialog).getByRole('button', { name: 'Accept as read' }));

    expect(await screen.findByText('1 document accepted.')).toBeInTheDocument();
    expect(
      screen.getByText('1 document could not be accepted: The document is being analysed again.'),
    ).toBeInTheDocument();
    const corrections = server.requests.filter(({ method }) => method === 'PATCH');
    expect(corrections.map(({ path }) => path)).toEqual([`/documents/${READY.id}`]);
    expect(jsonBody(corrections[0])).toEqual({
      type: 'note',
      confirm: { issuer: 'Synthetic issuer' },
    });
  });

  it('accepts only the documents of the selection that are to review', async () => {
    const server = queue([READY, SETTLED]);
    renderApp('/documents', server.fetch);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('checkbox', { name: 'Select all rows' }));
    await user.click(screen.getByRole('button', { name: 'Accept as read (1)' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Accept as read',
      }),
    );

    expect(await screen.findByText('1 document accepted.')).toBeInTheDocument();
    expect(
      server.requests.filter(({ method }) => method === 'PATCH').map(({ path }) => path),
    ).toEqual([`/documents/${READY.id}`]);
  });

  it('refuses a document settled since the list was read, and sends it nothing', async () => {
    const server = queue([READY], [{ ...READY, status: 'indexed' }]);
    renderApp('/review', server.fetch);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('checkbox', { name: 'Select Ready note' }));
    await user.click(screen.getByRole('button', { name: 'Accept as read (1)' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Accept as read',
      }),
    );

    expect(
      await screen.findByText(
        '1 document could not be accepted: The document is no longer to review.',
      ),
    ).toBeInTheDocument();
    expect(server.requests.some(({ method }) => method === 'PATCH')).toBe(false);
  });
});
