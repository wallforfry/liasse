import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { jobs } from '../db/schema/jobs.ts';
import { settings as settingsTable } from '../db/schema/settings.ts';
import { ingestionSources } from '../db/schema/sources.ts';
import { createDriveHarness, type DriveHarness } from '../sources/gdrive/gdrive.test-helper.ts';
import { openSourceSecret } from '../sources/secret.ts';
import {
  addSource,
  queuedPolls,
  storedSource,
  TEST_REDIRECT_URI,
  TEST_SECRETS,
} from '../sources/sources.test-helper.ts';
import { completeGoogleConsent, startGoogleConsent } from './google-consent.ts';
import { createSource } from './sources.ts';

const SESSION = 'session-synthetic-1';

describe('the consent of Google for a Drive source', () => {
  let harness: DriveHarness;

  beforeAll(async () => {
    harness = await createDriveHarness();
  });

  afterAll(async () => {
    await harness.dispose();
  });

  beforeEach(async () => {
    await harness.reset();
  });

  const db = () => harness.ingest.database.db;

  // A Drive source created as the web UI does: without an authorization yet.
  const unconnected = async () =>
    (
      await createSource(harness.context(), {
        kind: 'gdrive',
        name: 'Synthetic Drive',
        enabled: true,
        poll_interval_minutes: 5,
        private: false,
        config: { folder_id: 'root' },
      })
    ).id;

  const tokenOf = async (id: string) => {
    const { secret } = await storedSource(db(), id);
    return openSourceSecret(TEST_SECRETS, id, secret);
  };

  it('asks for offline read access to Drive, with PKCE, back to PUBLIC_URL', async () => {
    const id = await unconnected();
    const { url } = await startGoogleConsent(harness.context(), id, SESSION);
    const query = new URL(url).searchParams;
    expect(Object.fromEntries(query)).toMatchObject({
      client_id: harness.google.client.clientId,
      redirect_uri: TEST_REDIRECT_URI,
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/drive.readonly',
      access_type: 'offline',
      prompt: 'consent',
      code_challenge_method: 'S256',
    });
    expect(query.get('state')).not.toContain(SESSION);
  });

  it('seals the refresh token in the source, which then runs', async () => {
    const id = await unconnected();
    expect(await queuedPolls(db())).toHaveLength(0);
    const { url } = await startGoogleConsent(harness.context(), id, SESSION);

    const result = await completeGoogleConsent(
      harness.context(),
      harness.google.consent(url),
      SESSION,
    );

    expect(result).toEqual({ outcome: 'connected', source_id: id });
    expect((await tokenOf(id)).state).toBe('set');
    expect(await queuedPolls(db())).toHaveLength(1);
  });

  it('clears the flag of a refused authorization, the one way out of it, and runs the source', async () => {
    const id = await unconnected();
    const connect = async () =>
      completeGoogleConsent(
        harness.context(),
        harness.google.consent((await startGoogleConsent(harness.context(), id, SESSION)).url),
        SESSION,
      );
    expect(await connect()).toEqual({ outcome: 'connected', source_id: id });
    await db()
      .update(ingestionSources)
      .set({ needsAttention: true })
      .where(eq(ingestionSources.id, id));
    await db().delete(jobs);

    expect(await connect()).toEqual({ outcome: 'connected', source_id: id });

    expect(await storedSource(db(), id)).toMatchObject({ needsAttention: false });
    expect(await queuedPolls(db())).toHaveLength(1);
  });

  it('binds nothing for another session', async () => {
    const id = await unconnected();
    const { url } = await startGoogleConsent(harness.context(), id, SESSION);
    const result = await completeGoogleConsent(
      harness.context(),
      harness.google.consent(url),
      'session-synthetic-other',
    );
    expect(result).toEqual({ outcome: 'invalid' });
    expect((await tokenOf(id)).state).toBe('unset');
  });

  it('tells a declined consent apart', async () => {
    const id = await unconnected();
    const { url } = await startGoogleConsent(harness.context(), id, SESSION);
    const answer = harness.google.consent(url, { deny: true });
    expect(await completeGoogleConsent(harness.context(), answer, SESSION)).toEqual({
      outcome: 'denied',
      source_id: id,
    });
  });

  it('refuses and revokes a grant without the read access to Drive', async () => {
    const id = await unconnected();
    const { url } = await startGoogleConsent(harness.context(), id, SESSION);
    const answer = harness.google.consent(url, { scopes: ['openid'] });
    expect(await completeGoogleConsent(harness.context(), answer, SESSION)).toEqual({
      outcome: 'missing_scope',
      source_id: id,
    });
    expect(harness.google.revoked()).toHaveLength(1);
    expect((await tokenOf(id)).state).toBe('unset');
  });

  it('refuses a code exchanged with another verifier', async () => {
    const id = await unconnected();
    const first = await startGoogleConsent(harness.context(), id, SESSION);
    const second = await startGoogleConsent(harness.context(), id, SESSION);
    // The code of the first consent, with the state, and so the verifier, of the second.
    const answer = {
      ...harness.google.consent(first.url),
      state: new URL(second.url).searchParams.get('state') ?? '',
    };
    expect(await completeGoogleConsent(harness.context(), answer, SESSION)).toEqual({
      outcome: 'refused',
      source_id: id,
    });
  });

  it('revokes no token another Drive source may share a grant with', async () => {
    const id = await unconnected();
    const connect = async () => {
      const { url } = await startGoogleConsent(harness.context(), id, SESSION);
      await completeGoogleConsent(harness.context(), harness.google.consent(url), SESSION);
    };
    await connect();
    await connect();
    expect(harness.google.revoked()).toEqual([]);
    const other = await unconnected();
    const { url } = await startGoogleConsent(harness.context(), other, SESSION);
    const answer = harness.google.consent(url, { scopes: ['openid'] });
    await completeGoogleConsent(harness.context(), answer, SESSION);
    expect(harness.google.revoked()).toEqual([]);
  });

  it('needs the Google client in the settings, and a Drive source', async () => {
    const id = await unconnected();
    const mailbox = await addSource(db());
    await expect(startGoogleConsent(harness.context(), mailbox, SESSION)).rejects.toMatchObject({
      code: 'source_kind_mismatch',
    });
    await db().delete(settingsTable);
    await expect(startGoogleConsent(harness.context(), id, SESSION)).rejects.toMatchObject({
      code: 'google_client_missing',
    });
  });
});
