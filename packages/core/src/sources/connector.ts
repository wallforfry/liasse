import type { ImapSourceConfig } from '@liasse/contract';
import type { SourceKind } from '@liasse/contract/domain';
import type { JsonObject } from '../db/columns.ts';

/** One file a source holds, not downloaded yet. */
export interface SourceItem {
  /** What the source calls the item, unique within the source. */
  readonly externalId: string;
  /** A file name for the document: untrusted text. */
  readonly name: string;
  /** In bytes, when the source tells it before the download: a larger item is not opened. */
  readonly size?: number | undefined;
  /** The bytes of the item. Called at most once, before the next change is asked for. */
  readonly open: () => Promise<AsyncIterable<Uint8Array>>;
}

/**
 * A step of a listing. Once its item, if any, is handled, a run stores `cursor` and the
 * next run starts after it. A change without an item moves the cursor past what the
 * connector left out, such as messages without an attachment.
 */
export interface SourceChange {
  readonly cursor: JsonObject;
  readonly item?: SourceItem;
}

/** An open connection to a source, used by one run at a time. */
export interface SourceSession {
  /**
   * What the source holds after `cursor`, oldest first. A cursor of another shape, or
   * null, starts from the beginning the configuration names.
   */
  readonly changes: (cursor: JsonObject | null) => AsyncIterable<SourceChange>;
  readonly close: () => Promise<void>;
}

/**
 * The protocol of one kind of source. Any error other than the two below is transient:
 * the next attempt may not meet it.
 */
export interface SourceConnector<Config> {
  /** Rejects with `SourceCredentialsError` when the source refuses the credentials. */
  readonly connect: (
    config: Config,
    secret: string | undefined,
    signal: AbortSignal,
  ) => Promise<SourceSession>;
}

/** The configuration of each kind, as its schema in `@liasse/contract` outputs it. */
export interface SourceConfigs {
  readonly imap: ImapSourceConfig;
}

export type SourceConnectors = {
  readonly [Kind in SourceKind]: SourceConnector<SourceConfigs[Kind]>;
};

/** The source refused the credentials: polling stops until a person saves the source. */
export class SourceCredentialsError extends Error {
  override readonly name = 'SourceCredentialsError';
}

/** One item cannot be read, and reading it again would not help: it is skipped. */
export class SourceItemError extends Error {
  override readonly name = 'SourceItemError';
}
