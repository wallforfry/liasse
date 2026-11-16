import type { UploadResult } from '@liasse/sdk';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { isUnauthorized } from '../../api/errors.ts';
import { useClient } from '../../api/session.ts';

export type UploadOutcome =
  | { readonly status: 'waiting' }
  | { readonly status: 'uploading' }
  | { readonly status: 'uploaded'; readonly result: UploadResult }
  | { readonly status: 'failed'; readonly error: unknown };

export type SettledOutcome = Extract<UploadOutcome, { status: 'uploaded' | 'failed' }>;

export interface UploadEntry {
  readonly key: number;
  readonly name: string;
  readonly outcome: UploadOutcome;
}

export interface UploadBatch {
  readonly files: readonly File[];
  readonly hint: string;
  readonly private: boolean;
}

/**
 * Uploads the files one after the other, so each gets the whole request deadline and the
 * list shows them in the order chosen. A file the server refuses does not stop the others;
 * a lost session does, and fails the batch so the session provider sends to the login screen.
 */
export const useUploadBatch = (
  onBatchDone: (outcomes: readonly SettledOutcome[]) => Promise<void>,
) => {
  const client = useClient();
  const [entries, setEntries] = useState<readonly UploadEntry[]>([]);

  const mark = (index: number, outcome: UploadOutcome): void => {
    setEntries((current) =>
      current.map((entry) => (entry.key === index ? { ...entry, outcome } : entry)),
    );
  };

  const uploadOne = async (file: File, batch: UploadBatch): Promise<SettledOutcome> => {
    const hint = batch.hint.trim();
    try {
      const result = await client.uploadDocument({
        file,
        private: batch.private,
        ...(hint === '' ? {} : { hint }),
      });
      return { status: 'uploaded', result };
    } catch (error) {
      if (isUnauthorized(error)) throw error;
      return { status: 'failed', error };
    }
  };

  const mutation = useMutation({
    mutationFn: async (batch: UploadBatch): Promise<readonly SettledOutcome[]> => {
      setEntries(
        batch.files.map((file, key) => ({ key, name: file.name, outcome: { status: 'waiting' } })),
      );
      const settled: SettledOutcome[] = [];
      for (const [index, file] of batch.files.entries()) {
        mark(index, { status: 'uploading' });
        const outcome = await uploadOne(file, batch);
        mark(index, outcome);
        settled.push(outcome);
      }
      return settled;
    },
    onSuccess: onBatchDone,
  });

  return { entries, mutation };
};
