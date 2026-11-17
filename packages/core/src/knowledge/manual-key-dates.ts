import {
  type KeyDate,
  keyDateSchema,
  MAX_KEY_DATE_LABEL_LENGTH,
  MAX_KEY_DATES_PER_DOCUMENT,
} from '@liasse/contract/domain';
import { KEY_DATES_FIELD, ownValue } from '@liasse/contract/registry';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { documents } from '../db/schema/documents.ts';
import type { EntityReader, EntityTransaction } from '../entities/entity-store.ts';
import { type NoticePeriod, noticePeriodSchema } from './input.ts';
import { planManualKeyDates, replaceKeyDates } from './key-dates.ts';

const keyOf = ({ kind, date }: KeyDate): string => `${kind} ${date}`;

/**
 * The key dates a person gives in `core.key_dates`: the core field's shape, held to the
 * bounds of `document_dates`, each kind once per date, so that every one of them is a row
 * there as it is in the core.
 */
export const manualKeyDatesSchema = z
  .array(
    keyDateSchema.extend({
      label: keyDateSchema.shape.label.trim().min(1).max(MAX_KEY_DATE_LABEL_LENGTH),
    }),
  )
  .max(MAX_KEY_DATES_PER_DOCUMENT)
  .refine((keyDates) => new Set(keyDates.map(keyOf)).size === keyDates.length, {
    message: 'expected each kind of key date at most once per date',
  });

const storedNoticePeriodSchema = noticePeriodSchema.nullable();

/** The notice period the last extraction of a document read, if any. */
export const readNoticePeriod = async (
  reader: EntityReader,
  documentId: string,
): Promise<NoticePeriod | undefined> => {
  const [row] = await reader
    .select({ noticePeriod: documents.noticePeriod })
    .from(documents)
    .where(eq(documents.id, documentId));
  return storedNoticePeriodSchema.parse(row?.noticePeriod ?? null) ?? undefined;
};

/** The key dates of a core section, as a person gave them; none when it holds none. */
export const manualKeyDatesOf = (core: Readonly<Record<string, unknown>>): readonly KeyDate[] =>
  manualKeyDatesSchema.optional().parse(ownValue(core, KEY_DATES_FIELD)) ?? [];

/**
 * Writes `document_dates` from the key dates a person gave in the core of a document, as
 * just written, with the notice deadlines computed from its notice period: the two stay
 * the same dates. The caller holds the row of the document.
 */
export const storeManualKeyDates = async (
  tx: EntityTransaction,
  documentId: string,
): Promise<void> => {
  const [row] = await tx
    .select({ core: documents.core, noticePeriod: documents.noticePeriod })
    .from(documents)
    .where(eq(documents.id, documentId));
  if (row === undefined) return;
  const noticePeriod = storedNoticePeriodSchema.parse(row.noticePeriod) ?? undefined;
  await replaceKeyDates(
    tx,
    documentId,
    planManualKeyDates(manualKeyDatesOf(row.core), noticePeriod),
  );
};
