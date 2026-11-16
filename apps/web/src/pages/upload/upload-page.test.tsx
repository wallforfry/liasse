import { screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  errorBody,
  fakeServer,
  json,
  type Request,
  renderApp,
} from '../../test/render.test-helper.tsx';

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
    await user.upload(await screen.findByLabelText('Files'), file);
    await user.type(screen.getByLabelText('Hint (optional)'), ' electricity bill ');
    await user.click(screen.getByLabelText('Private'));
    await user.click(screen.getByRole('button', { name: 'Upload' }));

    expect(await screen.findByRole('heading', { name: 'synthetic-bill.pdf' })).toBeInTheDocument();
    const upload = server.requests.find(({ method }) => method === 'POST');
    expect(upload?.credentials).toBe('same-origin');
    const form = upload?.body;
    if (!(form instanceof FormData)) throw new Error('Expected a multipart form');
    expect(form.get('private')).toBe('true');
    expect(form.get('hint')).toBe('electricity bill');
    const sent = form.get('file');
    expect(sent instanceof File ? sent.name : undefined).toBe('synthetic-bill.pdf');
  });

  it('uploads several files one after the other and reports each, without leaving the page', async () => {
    const answers: Readonly<Record<string, Response>> = {
      'first.pdf': json({ id: 'doc_01FIRST', status: 'received', duplicate: false }, 201),
      'second.pdf': json({ id: 'doc_01SECOND', status: 'indexed', duplicate: true }, 200),
      'third.pdf': errorBody(413, 'file_too_large', 'The file is larger than 20 MiB.'),
    };
    const server = fakeServer((request) =>
      request.method === 'POST' && request.path === '/documents'
        ? answers[sentName(request) ?? '']
        : undefined,
    );
    renderApp('/upload', server.fetch);
    const user = userEvent.setup();
    await user.upload(await screen.findByLabelText('Files'), [
      pdf('first.pdf'),
      pdf('second.pdf'),
      pdf('third.pdf'),
    ]);
    await user.type(screen.getByLabelText('Hint (optional)'), 'bank statement');
    await user.click(screen.getByRole('button', { name: 'Upload 3 files' }));

    const list = await screen.findByRole('list', { name: 'Uploads' });
    expect(await within(list).findByText('The file is larger than 20 MiB.')).toBeInTheDocument();
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual([
      'first.pdf Uploaded',
      'second.pdf Already in Liasse',
      'third.pdf The file is larger than 20 MiB.',
    ]);
    expect(within(list).getByRole('link', { name: 'Uploaded' })).toHaveAttribute(
      'href',
      '/documents/doc_01FIRST',
    );
    const uploads = server.requests.filter(({ method }) => method === 'POST');
    expect(uploads.map(sentName)).toEqual(['first.pdf', 'second.pdf', 'third.pdf']);
    expect(uploads.map((request) => formOf(request).get('hint'))).toEqual([
      'bank statement',
      'bank statement',
      'bank statement',
    ]);
    expect(screen.getByRole('heading', { name: 'Upload' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload' })).toBeDisabled();
  });

  it('shows why a single file was refused', async () => {
    const server = fakeServer((request) =>
      request.method === 'POST' && request.path === '/documents'
        ? errorBody(415, 'unsupported_media_type', 'This format is not supported.')
        : undefined,
    );
    renderApp('/upload', server.fetch);
    const user = userEvent.setup();
    await user.upload(await screen.findByLabelText('Files'), pdf('only.pdf'));
    await user.click(screen.getByRole('button', { name: 'Upload' }));

    const list = await screen.findByRole('list', { name: 'Uploads' });
    expect(await within(list).findByText('This format is not supported.')).toBeInTheDocument();
  });

  it('stops the batch and goes to the login page when the session is lost', async () => {
    const server = fakeServer((request) =>
      request.method === 'POST' && request.path === '/documents'
        ? errorBody(401, 'unauthorized', 'A valid session or API key is required.')
        : undefined,
    );
    renderApp('/upload', server.fetch);
    const user = userEvent.setup();
    await user.upload(await screen.findByLabelText('Files'), [pdf('a.pdf'), pdf('b.pdf')]);
    await user.click(screen.getByRole('button', { name: 'Upload 2 files' }));

    expect(await screen.findByRole('button', { name: 'Log in' })).toBeInTheDocument();
    expect(server.requests.filter(({ method }) => method === 'POST').map(sentName)).toEqual([
      'a.pdf',
    ]);
  });
});

const pdf = (name: string): File =>
  new File(['%PDF-1.4 synthetic'], name, { type: 'application/pdf' });

const formOf = (request: Request): FormData => {
  if (!(request.body instanceof FormData)) throw new Error('Expected a multipart form');
  return request.body;
};

const sentName = (request: Request): string | undefined => {
  const sent = formOf(request).get('file');
  return sent instanceof File ? sent.name : undefined;
};
