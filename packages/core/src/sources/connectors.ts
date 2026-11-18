import type { SourceConnectors } from './connector.ts';
import { imapConnector } from './imap/connector.ts';

/** The connector of every kind of source. */
export const SOURCE_CONNECTORS: SourceConnectors = { imap: imapConnector };
