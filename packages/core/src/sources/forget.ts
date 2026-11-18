import { and, eq, isNotNull } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { ingestionSources } from '../db/schema/sources.ts';
import type { SourceConnectors } from './connector.ts';

const FORGET_TIMEOUT_MS = 30_000;

/**
 * Revokes a Drive token unless another Drive source still holds one. Google documents a
 * revocation as ending the grant of the client for the account, every token of it
 * included, and Liasse does not know which account a source connected: a token is left to
 * end on its own (six months unused) rather than cut the authorization of another source.
 * Best effort: a refusal or an outage of Google changes nothing in Liasse.
 */
export const forgetDriveToken = async (
  db: Database,
  connectors: SourceConnectors,
  token: string,
): Promise<void> => {
  const { forget } = connectors.gdrive;
  if (forget === undefined) return;
  const holders = await db.$count(
    ingestionSources,
    and(eq(ingestionSources.kind, 'gdrive'), isNotNull(ingestionSources.secret)),
  );
  if (holders > 0) return;
  await forget(token, AbortSignal.timeout(FORGET_TIMEOUT_MS)).catch(() => undefined);
};
