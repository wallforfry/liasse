import type { SourceError, SourceRun, SourceSkippedItem } from '@liasse/contract';
import { MAX_SOURCE_SKIPPED_ITEMS } from '@liasse/contract/domain';

const MAX_MESSAGE_LENGTH = 1000;

export type ItemOutcome =
  | { readonly kind: 'ingested' }
  | { readonly kind: 'duplicate' }
  | { readonly kind: 'skipped'; readonly item: SourceSkippedItem };

export interface RunTally {
  readonly ingested: number;
  readonly duplicates: number;
  readonly skipped: number;
  readonly skippedItems: readonly SourceSkippedItem[];
}

export const EMPTY_TALLY: RunTally = { ingested: 0, duplicates: 0, skipped: 0, skippedItems: [] };

export const countOutcome = (tally: RunTally, outcome: ItemOutcome): RunTally => {
  switch (outcome.kind) {
    case 'ingested':
      return { ...tally, ingested: tally.ingested + 1 };
    case 'duplicate':
      return { ...tally, duplicates: tally.duplicates + 1 };
    case 'skipped':
      return {
        ...tally,
        skipped: tally.skipped + 1,
        skippedItems:
          tally.skippedItems.length < MAX_SOURCE_SKIPPED_ITEMS
            ? [...tally.skippedItems, outcome.item]
            : tally.skippedItems,
      };
  }
};

/** A message for the summary, cut to size: it may quote the server. */
export const summaryMessage = (message: string): string =>
  message.length > MAX_MESSAGE_LENGTH ? `${message.slice(0, MAX_MESSAGE_LENGTH - 1)}…` : message;

export const summaryOf = (
  startedAt: Date,
  tally: RunTally,
  error: SourceError | null,
): SourceRun => ({
  started_at: startedAt.toISOString(),
  finished_at: new Date().toISOString(),
  ingested: tally.ingested,
  duplicates: tally.duplicates,
  skipped: tally.skipped,
  skipped_items: [...tally.skippedItems],
  error,
});
