import { screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeServer, json, renderApp, TEST_CSRF } from '../test/render.test-helper.tsx';

const UPLOADED = {
  id: 'doc_01UPLOADED',
  status: 'received',
  state: 'current',
  type: null,
  title: null,
  summary: null,
  mime: 'application/pdf',
  original_name: 'synthetic-bill.pdf',
  source: 'api',
  private: true,
  confidence: null,
  error: null,
  core: {},
  ingested_at: '2026-11-15T10:00:00.000Z',
  updated_at: '2026-11-15T10:00:00.000Z',
  schema_version: null,
  hint: 'electricity bill',
  fields: {},
  text: { content: '', offset: 0, total_length: 0, has_more: false },
};

describe('the upload page', () => {
  it('sends the file with its hint and privacy, then opens the new document', async () => {
    const server = fakeServer((request) => {
      if (request.method === 'POST' && request.path === '/documents') {
        return json({ id: UPLOADED.id, status: 'received', duplicate: false }, 201);
      }
      if (request.path.startsWith(`/documents/${UPLOADED.id}`)) {
        return json({ ...UPLOADED, status: 'indexed' });
      }
      return undefined;
    });
    renderApp('/upload', server.fetch);
    const user = userEvent.setup();
    const file = new File(['%PDF-1.4 synthetic'], 'synthetic-bill.pdf', {
      type: 'application/pdf',
    });
    await user.upload(await screen.findByLabelText('File'), file);
    await user.type(screen.getByLabelText('Hint (optional)'), ' electricity bill ');
    await user.click(screen.getByLabelText('Private'));
    await user.click(screen.getByRole('button', { name: 'Upload' }));

    expect(await screen.findByRole('heading', { name: 'synthetic-bill.pdf' })).toBeInTheDocument();
    const upload = server.requests.find(({ method }) => method === 'POST');
    expect(upload?.headers.get('X-CSRF-Token')).toBe(TEST_CSRF);
    const form = upload?.body;
    if (!(form instanceof FormData)) throw new Error('Expected a multipart form');
    expect(form.get('private')).toBe('true');
    expect(form.get('hint')).toBe('electricity bill');
    const sent = form.get('file');
    expect(sent instanceof File ? sent.name : undefined).toBe('synthetic-bill.pdf');
  });
});
