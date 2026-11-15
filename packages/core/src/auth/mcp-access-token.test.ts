import { exportJWK, generateKeyPair, type JWTPayload, SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestAuth, createTestDatabase, type TestDatabase } from '../testing/index.ts';
import { type AccessTokenCheck, createAccessTokenCheck } from './mcp-access-token.ts';
import type { McpGrantCheck } from './mcp-grant.ts';

const PUBLIC_URL = 'https://liasse.example.com';
const RESOURCE = `${PUBLIC_URL}/mcp`;
const ISSUER = `${PUBLIC_URL}/api/auth`;
const KEY_ID = 'synthetic-key';

/**
 * A token as the OAuth provider writes one, signed with a key of the test, from which each
 * case removes one property. The check under test reads that key in place of the server's.
 */
describe('the access token check of /mcp', () => {
  let database: TestDatabase;
  let check: AccessTokenCheck;
  let checkWith: (grantIsLive: McpGrantCheck) => AccessTokenCheck;
  let sign: (claims: JWTPayload, typ?: string) => Promise<string>;

  beforeAll(async () => {
    database = await createTestDatabase();
    const auth = await createTestAuth(database.db, PUBLIC_URL);
    const { publicKey, privateKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519' });
    const jwk = { ...(await exportJWK(publicKey)), kid: KEY_ID, alg: 'EdDSA' };
    checkWith = (grantIsLive) =>
      createAccessTokenCheck(auth, RESOURCE, grantIsLive, () => Promise.resolve({ keys: [jwk] }));
    check = checkWith(() => Promise.resolve(true));
    sign = async (claims, typ = 'at+jwt') =>
      new SignJWT({ iss: ISSUER, azp: 'synthetic-client', scope: 'openid', ...claims })
        .setProtectedHeader({ alg: 'EdDSA', kid: KEY_ID, typ })
        .setAudience(RESOURCE)
        .setSubject('usr_synthetic')
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(privateKey);
  });

  afterAll(async () => {
    await database.dispose();
  });

  const presented = (token: string, scheme = 'Bearer') =>
    check({
      authorization: `${scheme} ${token}`,
      dpop: undefined,
      method: 'POST',
      url: RESOURCE,
    });

  it('accepts a token of this issuer for /mcp, typed as an access token', async () => {
    expect(await presented(await sign({}))).toBe(true);
  });

  it('asks the grant check with the client and issue time of the token, and obeys it', async () => {
    const asked: [string, number][] = [];
    const refusing = checkWith((clientId, issuedAt) => {
      asked.push([clientId, issuedAt]);
      return Promise.resolve(false);
    });
    const token = await sign({});
    const refused = await refusing({
      authorization: `Bearer ${token}`,
      dpop: undefined,
      method: 'POST',
      url: RESOURCE,
    });
    expect(refused).toBe(false);
    expect(asked).toEqual([['synthetic-client', expect.any(Number)]]);
  });

  it('refuses a token with the audience of /mcp but another type', async () => {
    expect(await presented(await sign({}, 'JWT'))).toBe(false);
  });

  it('refuses a token for /mcp from another issuer', async () => {
    expect(await presented(await sign({ iss: 'https://other.example.com/api/auth' }))).toBe(false);
  });

  it('refuses a DPoP-bound token sent without its proof', async () => {
    const bound = await sign({ cnf: { jkt: 'synthetic-thumbprint' } });
    expect(await presented(bound)).toBe(false);
    expect(await presented(bound, 'DPoP')).toBe(false);
  });
});
