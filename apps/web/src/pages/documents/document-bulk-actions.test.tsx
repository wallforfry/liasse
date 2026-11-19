import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { errorBody, fakeServer, json, renderApp } from '../../test/render.test-helper.tsx';

const summary = (id: string, title: string, status: string) => ({
  id,
  status,
  state: 'current',
  type: 'energy_bill',
  title,
  summary: null,
  mime: 'application/pdf',
  original_name: `${id}.pdf`,
  source: 'api',
  private: false,
  confidence: 0.9,
  error: status === 'failed' ? 'model_provider_failed' : null,
  core: {},
  ingested_at: '2026-11-01T09:00:00.000Z',
  updated_at: '2026-11-01T09:00:00.000Z',
});

const FAILED = summary('doc_synthetic_failed', 'Failed bill', 'failed');
const INDEXED = summary('doc_synthetic_indexed', 'Indexed bill', 'indexed');
const REFUSED = summary('doc_synthetic_refused', 'Refused bill', 'indexed');

const library = () =>
  fakeServer((request) => {
    if (request.path.startsWith('/types')) return json({ types: [] });
    if (request.path.startsWith('/entities')) return json({ entities: [], total: 0 });
    if (request.method === 'POST' && request.path === `/documents/${FAILED.id}/retry`) {
      return json(
        {
          ...FAILED,
          status: 'received',
          error: null,
          schema_version: null,
          hint: null,
          analysis_pending: false,
        },
        202,
      );
    }
    if (request.method === 'DELETE' && request.path === `/documents/${REFUSED.id}`) {
      return errorBody(404, 'not_found', 'No document has this id.');
    }
    if (request.method === 'DELETE') return new Response(null, { status: 204 });
    if (request.path.startsWith('/documents')) {
      return json({ documents: [FAILED, INDEXED, REFUSED], total: 3, has_more: false });
    }
    return undefined;
  });

const sent = (server: ReturnType<typeof library>, method: string) =>
  server.requests.filter((request) => request.method === method).map(({ path }) => path);

const listings = (server: ReturnType<typeof library>) =>
  server.requests.filter(({ path }) => path.startsWith('/documents?')).length;

describe('the bulk actions of the document list', () => {
  it('shows its actions only once a document is selected, and clears the selection', async () => {
    renderApp('/documents', library().fetch);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('checkbox', { name: 'Select Indexed bill' }));

    const bar = screen.getByRole('toolbar', { name: 'Actions on the selected rows' });
    expect(within(bar).getByText('1 row selected')).toBeInTheDocument();
    expect(within(bar).queryByRole('button', { name: /Retry failed/ })).toBeNull();
    await user.click(within(bar).getByRole('button', { name: 'Clear selection' }));
    expect(screen.queryByRole('toolbar')).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Select Indexed bill' })).not.toBeChecked();
  });

  it('selects every document shown from the header, and retries only the failed ones', async () => {
    const server = library();
    renderApp('/documents', server.fetch);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('checkbox', { name: 'Select all rows' }));
    expect(screen.getByText('3 rows selected')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry failed (1)' }));
    expect(await screen.findByText('1 document queued again.')).toBeInTheDocument();
    expect(sent(server, 'POST')).toEqual([`/documents/${FAILED.id}/retry`]);
    expect(screen.queryByRole('toolbar')).toBeNull();
  });

  it('deletes the selected documents after the confirmation, and reports a refusal', async () => {
    const server = library();
    renderApp('/documents', server.fetch);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('checkbox', { name: 'Select Indexed bill' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Refused bill' }));
    expect(screen.getByRole('checkbox', { name: 'Select all rows' })).toHaveAttribute(
      'data-state',
      'indeterminate',
    );
    await user.click(screen.getByRole('button', { name: 'Delete (2)' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Delete 2 documents?')).toBeInTheDocument();
    expect(sent(server, 'DELETE')).toEqual([]);
    const before = listings(server);
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(await screen.findByText('1 document deleted.')).toBeInTheDocument();
    expect(
      screen.getByText('1 document could not be deleted: No document has this id.'),
    ).toBeInTheDocument();
    expect(sent(server, 'DELETE').toSorted()).toEqual([
      `/documents/${INDEXED.id}`,
      `/documents/${REFUSED.id}`,
    ]);
    await waitFor(() => {
      expect(listings(server)).toBeGreaterThan(before);
    });
  });
});
