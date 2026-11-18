import type { SourceCheck } from '@liasse/contract';
import { SOURCE_CHECK_SAMPLE } from '@liasse/contract/domain';
import type { SecretBox } from '../settings/secret-box.ts';
import { SourceCredentialsError, type SourceConnectors } from './connector.ts';
import { summaryMessage } from './run-summary.ts';
import { connectSource } from './connect.ts';
import type { StoredSource } from './store.ts';

export interface SourceCheckDeps {
  readonly secrets: SecretBox;
  readonly connectors: SourceConnectors;
}

const firstItems = async (
  { secrets, connectors }: SourceCheckDeps,
  source: StoredSource,
  signal: AbortSignal,
): Promise<readonly string[]> => {
  const session = await connectSource(secrets, connectors, source, signal);
  const names: string[] = [];
  try {
    for await (const { item } of session.changes(source.cursor)) {
      if (names.length >= SOURCE_CHECK_SAMPLE) break;
      if (item !== undefined) names.push(item.name);
    }
  } finally {
    await session.close().catch(() => undefined);
  }
  return names;
};

/**
 * Connects to a source with its stored credentials and lists the first items its next run
 * would take, without downloading or ingesting any, and without moving its cursor.
 */
export const checkSource = async (
  deps: SourceCheckDeps,
  source: StoredSource,
  signal: AbortSignal,
): Promise<SourceCheck> => {
  try {
    const names = await firstItems(deps, source, signal);
    return { ok: true, items: names.map((name) => ({ name })) };
  } catch (error) {
    const message = summaryMessage(error instanceof Error ? error.message : String(error));
    return {
      ok: false,
      error: {
        kind: error instanceof SourceCredentialsError ? 'credentials' : 'transient',
        message,
      },
    };
  }
};
