import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { oauthClientRevocations, oauthClients } from '../db/schema/index.ts';
import { createTestDatabase, type TestDatabase } from '../testing/index.ts';
import { createMcpGrantCheck, type McpGrantCheck } from './mcp-grant.ts';

const REVOKED_AT = new Date('2026-05-01T10:00:00.400Z');
const REVOKED_SECOND = Math.floor(REVOKED_AT.getTime() / 1000);

// The rows the OAuth provider writes, inserted here: the check reads nothing else of them.
const clientRow = (clientId: string, disabled: boolean) => ({
  id: `ocl_${clientId}`,
  clientId,
  disabled,
  redirectUris: ['https://client.example.net/callback'],
});

describe('the grant check of an MCP access token', () => {
  let database: TestDatabase;
  let grantIsLive: McpGrantCheck;

  beforeAll(async () => {
    database = await createTestDatabase();
    grantIsLive = createMcpGrantCheck(database.db);
    await database.db
      .insert(oauthClients)
      .values([
        clientRow('synthetic-live', false),
        clientRow('synthetic-disabled', true),
        clientRow('synthetic-revoked', false),
      ]);
    await database.db
      .insert(oauthClientRevocations)
      .values({ clientId: 'synthetic-revoked', revokedAt: REVOKED_AT });
  });

  afterAll(async () => {
    await database.dispose();
  });

  it('holds for a registered, enabled client never revoked', async () => {
    expect(await grantIsLive('synthetic-live', REVOKED_SECOND)).toBe(true);
  });

  it('fails for a client no longer registered, or disabled', async () => {
    expect(await grantIsLive('synthetic-unknown', REVOKED_SECOND)).toBe(false);
    expect(await grantIsLive('synthetic-disabled', REVOKED_SECOND)).toBe(false);
  });

  it('fails for a token issued up to the second of the revocation, holds after it', async () => {
    expect(await grantIsLive('synthetic-revoked', REVOKED_SECOND - 1)).toBe(false);
    expect(await grantIsLive('synthetic-revoked', REVOKED_SECOND)).toBe(false);
    expect(await grantIsLive('synthetic-revoked', REVOKED_SECOND + 1)).toBe(true);
  });
});
