import { errorBodySchema, googleConsentSchema, sourceSchema } from '@liasse/contract';
import { SETTLED_STATUSES } from '@liasse/contract/domain';
import { documents } from '@liasse/core/db';
import {
  buildSyntheticPdf,
  type FakeGoogle,
  startFakeGoogle,
  syntheticPdf,
  waitUntil,
} from '@liasse/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Runtime } from './create-runtime.ts';
import { useRuntimeHarness } from './runtime.test-helper.ts';

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

describe('a Drive source of a running server', () => {
  const harness = useRuntimeHarness();
  const { callAsPerson, call } = harness;
  let google: FakeGoogle;

  beforeEach(async () => {
    google = await startFakeGoogle();
  });

  afterEach(async () => {
    await google.close();
  });

  const start = () =>
    harness.start(
      {},
      { google: google.endpoints },
      { google: { client_id: google.client.clientId, client_secret: google.client.clientSecret } },
    );

  const connected = async (runtime: Runtime, folderId: string) => {
    const created = await callAsPerson(
      runtime,
      '/sources',
      json('POST', { kind: 'gdrive', name: 'Synthetic Drive', config: { folder_id: folderId } }),
    );
    expect(created.status).toBe(201);
    const source = sourceSchema.parse(await created.json());
    expect(source.secret).toBe('unset');

    const authorize = await callAsPerson(runtime, `/sources/${source.id}/google/authorize`, {
      method: 'POST',
    });
    expect(authorize.status).toBe(200);
    const { url } = googleConsentSchema.parse(await authorize.json());
    const answer = new URLSearchParams(google.consent(url));
    const callback = await callAsPerson(runtime, `/sources/google/callback?${answer.toString()}`, {
      redirect: 'manual',
    });
    expect(callback.status).toBe(302);
    expect(callback.headers.get('Location')).toBe(
      `/ui/sources?google=connected&source=${source.id}`,
    );
    return source.id;
  };

  const liveDocument = async () => {
    const rows = await harness.database().db.select().from(documents);
    return rows.find(({ status }) => status !== 'deleted');
  };

  it('ingests by reference, serves the file from Drive, and refuses one that changed or left', async () => {
    const folder = google.drive.folder('Invoices');
    const bytes = buildSyntheticPdf([{ lines: ['Synthetic Energy SA', 'Invoice SYN-2026-042'] }]);
    const file = google.drive.file('invoice.pdf', folder, bytes);
    const runtime = await start();
    const sourceId = await connected(runtime, folder);

    // Settled means the text stage read the file from Drive, checked against its hash.
    await waitUntil(async () => {
      const status = (await liveDocument())?.status;
      return status !== undefined && SETTLED_STATUSES.includes(status);
    });
    const document = await liveDocument();
    expect(document).toMatchObject({ storageKey: null, fileAtSource: true });
    const id = document?.id ?? '';

    const served = await call(runtime, `/documents/${id}/file`);
    expect(served.status).toBe(200);
    expect(Buffer.from(await served.arrayBuffer()).equals(Buffer.from(bytes))).toBe(true);

    google.drive.update(file, syntheticPdf('drive invoice, edited'));
    const changed = await call(runtime, `/documents/${id}/file`);
    expect(changed.status).toBe(409);
    expect(errorBodySchema.parse(await changed.json()).error.code).toBe('file_changed');

    google.drive.trash(file);
    const gone = await call(runtime, `/documents/${id}/file`);
    expect(gone.status).toBe(410);
    expect(errorBodySchema.parse(await gone.json()).error.code).toBe('file_unavailable');

    const deleted = await callAsPerson(runtime, `/sources/${sourceId}`, { method: 'DELETE' });
    expect(deleted.status).toBe(204);
    expect(google.revoked()).toHaveLength(1);
  });

  it('answers a consent of another session with no source bound', async () => {
    const runtime = await start();
    const created = await callAsPerson(
      runtime,
      '/sources',
      json('POST', { kind: 'gdrive', name: 'Synthetic Drive', config: { folder_id: 'root' } }),
    );
    const { id } = sourceSchema.parse(await created.json());
    const authorize = await callAsPerson(runtime, `/sources/${id}/google/authorize`, {
      method: 'POST',
    });
    const { url } = googleConsentSchema.parse(await authorize.json());
    const tampered = new URLSearchParams({ ...google.consent(url), state: 'v1.forged' });
    const callback = await callAsPerson(
      runtime,
      `/sources/google/callback?${tampered.toString()}`,
      {
        redirect: 'manual',
      },
    );
    expect(callback.headers.get('Location')).toBe('/ui/sources?google=invalid');
    // An API key is not the session of the web UI: it can start no consent.
    const withKey = await call(runtime, `/sources/${id}/google/authorize`, { method: 'POST' });
    expect(withKey.status).toBe(401);
  });
});
