import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeServer, json, jsonBody, renderApp } from '../../test/render.test-helper.tsx';

const MARKUP = '<img src=x onerror="alert(1)"><b>bold</b>';

const reviewed = (name: string, section: 'core' | 'fields', doubtful: boolean) => ({
  section,
  name,
  confidence: doubtful ? 0.4 : 0.95,
  page: 2,
  quote: `Quote of ${name} ${MARKUP}`,
  manual: false,
  doubtful,
  confirmable: true,
});

// A flagged document with the review the server gives it.
const FLAGGED_DOCUMENT = {
  id: 'doc_01FLAGGED',
  status: 'needs_review',
  state: 'current',
  type: 'note',
  title: 'Flagged note',
  summary: null,
  mime: 'application/pdf',
  original_name: 'note.pdf',
  source: 'api',
  private: false,
  confidence: 0.4,
  error: null,
  ingested_at: '2026-11-15T10:00:00.000Z',
  updated_at: '2026-11-15T10:00:00.000Z',
  schema_version: 1,
  hint: null,
  fields: { note: 'Synthetic note' },
  text: { content: 'Synthetic text', offset: 0, total_length: 14, has_more: false },
  core: { issuer: `Issuer ${MARKUP}`, reference: 'SYN-1', amount: { amount: 12, currency: 'EUR' } },
  review: {
    threshold: 0.7,
    reasons: ['low_confidence'],
    rejected_values: 0,
    type: { confidence: 0.9, outcome: 'existing', manual: false, doubtful: false },
    values: [
      reviewed('issuer', 'core', true),
      reviewed('reference', 'core', true),
      reviewed('amount', 'core', true),
      reviewed('note', 'fields', false),
    ],
  },
};

const serve = () =>
  fakeServer((request) =>
    request.path.startsWith('/documents/doc_01FLAGGED') ? json(FLAGGED_DOCUMENT) : undefined,
  );

describe('the review panel', () => {
  it('reviews a flagged document in one correction, values accepted unless rejected or edited', async () => {
    const server = serve();
    const { container } = renderApp('/documents/doc_01FLAGGED', server.fetch);
    const user = userEvent.setup();
    expect(await screen.findByText('To review')).toBeInTheDocument();
    expect(
      screen.getByText('Its confidence, 40%, is below the threshold of 70%.'),
    ).toBeInTheDocument();
    expect(screen.getByText(`Quote of issuer ${MARKUP}`)).toBeInTheDocument();
    expect(container.querySelector('b')).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Correct' })).toBeNull();
    expect(screen.getAllByText('Synthetic note')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Other values' }));
    expect(screen.getAllByText('Synthetic note')).toHaveLength(2);
    const decision = (name: string) => screen.getByRole('group', { name: `Decision for ${name}` });
    await user.click(within(decision('reference')).getByRole('button', { name: 'Reject' }));
    await user.click(within(decision('amount')).getByRole('button', { name: 'Edit' }));
    const amount = screen.getByLabelText('New value of amount');
    await user.clear(amount);
    await user.click(amount);
    await user.paste('{"amount":13,"currency":"EUR"}');
    await user.click(screen.getByRole('button', { name: 'Submit review' }));
    await waitFor(() => {
      expect(jsonBody(server.requests.find(({ method }) => method === 'PATCH'))).toEqual({
        type: 'note',
        confirm: { issuer: `Issuer ${MARKUP}` },
        core: { reference: null, amount: { amount: 13, currency: 'EUR' } },
      });
    });
  });

  it('resets every decision with Set all to Accept', async () => {
    const server = serve();
    renderApp('/documents/doc_01FLAGGED', server.fetch);
    const user = userEvent.setup();
    const reference = await screen.findByRole('group', { name: 'Decision for reference' });
    await user.click(within(reference).getByRole('button', { name: 'Reject' }));
    await user.click(screen.getByRole('button', { name: 'Set all to Accept' }));
    expect(within(reference).getByRole('button', { name: 'Accept' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(screen.getByRole('button', { name: 'Submit review' }));
    await waitFor(() => {
      expect(jsonBody(server.requests.find(({ method }) => method === 'PATCH'))).toEqual({
        type: 'note',
        confirm: {
          issuer: `Issuer ${MARKUP}`,
          reference: 'SYN-1',
          amount: { amount: 12, currency: 'EUR' },
        },
      });
    });
  });

  it('leaves the fields out of a review that changes the type', async () => {
    const document = {
      ...FLAGGED_DOCUMENT,
      review: {
        ...FLAGGED_DOCUMENT.review,
        values: [reviewed('reference', 'core', true), reviewed('note', 'fields', true)],
      },
    };
    const types = {
      types: [
        {
          slug: 'invoice',
          aliases: [],
          description: 'A request for payment.',
          parent_slug: null,
          version: 1,
          status: 'stable',
          fields: {},
          document_count: 0,
        },
      ],
    };
    const server = fakeServer((request) => {
      if (request.path.startsWith('/types')) return json(types);
      return request.path.startsWith('/documents/doc_01FLAGGED') ? json(document) : undefined;
    });
    renderApp('/documents/doc_01FLAGGED', server.fetch);
    const user = userEvent.setup();
    const typeDecision = await screen.findByRole('group', { name: 'Decision for the type' });
    await user.click(within(typeDecision).getByRole('button', { name: 'Change' }));
    await user.click(screen.getByRole('combobox', { name: 'Type' }));
    await user.click(await screen.findByRole('option', { name: /^invoice/ }));
    expect(screen.getByText('Will be extracted again for the new type.')).toBeInTheDocument();
    const note = screen.getByRole('group', { name: 'Decision for note' });
    expect(within(note).getByRole('button', { name: 'Accept' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Submit review' }));
    await waitFor(() => {
      expect(jsonBody(server.requests.find(({ method }) => method === 'PATCH'))).toEqual({
        type: 'invoice',
        confirm: { reference: 'SYN-1' },
      });
    });
  });

  it('lists what the server refused in the review', async () => {
    const server = fakeServer((request) => {
      if (request.method === 'PATCH') {
        return json(
          {
            error: {
              code: 'invalid_correction',
              message: 'The correction was refused.',
              request_id: 'req_synthetic',
              errors: [
                { code: 'unknown_field', message: 'There is no value "issuer" to confirm.' },
              ],
            },
          },
          400,
        );
      }
      return request.path.startsWith('/documents/doc_01FLAGGED')
        ? json(FLAGGED_DOCUMENT)
        : undefined;
    });
    renderApp('/documents/doc_01FLAGGED', server.fetch);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Submit review' }));
    expect(await screen.findByText('The correction was not saved')).toBeInTheDocument();
    expect(screen.getByText('There is no value "issuer" to confirm.')).toBeInTheDocument();
  });
});
