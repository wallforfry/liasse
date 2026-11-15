import type { KeyDateKind } from '@liasse/contract/domain';
import { eq } from 'drizzle-orm';
import { documentDates } from '../db/schema/knowledge.ts';
import { redactSensitiveIdentifiers } from '../entities/detect-sensitive.ts';
import type { EntityTransaction } from '../entities/entity-store.ts';
import type { KnowledgeKeyDate, NoticePeriod } from './input.ts';
import { subtractPeriod } from './notice-deadline.ts';

// A row of `document_dates` without its document. A date Liasse computed has no model, no
// page and no quote: that is what marks it as computed.
export interface KeyDateRow {
  readonly kind: KeyDateKind;
  readonly date: string;
  readonly label: string;
  readonly model: string | null;
  readonly schemaVersion: number | null;
  readonly page: number | null;
  readonly quote: string | null;
  readonly confidence: number | null;
}

const NOTICE_DEADLINE = 'notice_deadline' satisfies KeyDateKind;
const RENEWAL = 'renewal' satisfies KeyDateKind;

const describePeriod = ({ amount, unit }: NoticePeriod): string =>
  `${String(amount)} ${amount === 1 ? unit.slice(0, -1) : unit}`;

// The deadline rests on two extracted values, and is as sure as the less sure of them.
const noticeDeadline = (renewal: KnowledgeKeyDate, period: NoticePeriod): readonly KeyDateRow[] => {
  const date = subtractPeriod(renewal.date, period);
  return date === undefined
    ? []
    : [
        {
          kind: NOTICE_DEADLINE,
          date,
          label: `Notice deadline: ${describePeriod(period)} before ${renewal.label}`,
          model: null,
          schemaVersion: renewal.schemaVersion,
          page: null,
          quote: null,
          confidence: Math.min(renewal.confidence, period.confidence),
        },
      ];
};

const withoutRepeats = (rows: readonly KeyDateRow[]): readonly KeyDateRow[] =>
  rows.filter(
    (row, index) =>
      rows.findIndex((other) => other.kind === row.kind && other.date === row.date) === index,
  );

/**
 * The key dates to store for a document. With a notice period and a renewal date, the
 * notice deadline is the renewal date minus the period, one per renewal date, and every
 * notice deadline the model proposed is dropped: it is computed, never read. Without
 * either, no computation is possible and what the model proposed is kept. A kind is kept
 * once per date, and no label or quote keeps an IBAN or a card number in clear.
 */
export const planKeyDates = (
  keyDates: readonly KnowledgeKeyDate[],
  noticePeriod: NoticePeriod | undefined,
): readonly KeyDateRow[] => {
  const computed =
    noticePeriod === undefined
      ? []
      : keyDates
          .filter(({ kind }) => kind === RENEWAL)
          .flatMap((renewal) => noticeDeadline(renewal, noticePeriod));
  const extracted = keyDates
    .filter(({ kind }) => computed.length === 0 || kind !== NOTICE_DEADLINE)
    .map((keyDate) => ({ ...keyDate, quote: redactSensitiveIdentifiers(keyDate.quote) }));
  return withoutRepeats(
    [...extracted, ...computed].map((row) => ({
      ...row,
      label: redactSensitiveIdentifiers(row.label),
    })),
  );
};

// Replaces the key dates of a document. The caller holds the row of the document.
export const replaceKeyDates = async (
  tx: EntityTransaction,
  documentId: string,
  rows: readonly KeyDateRow[],
): Promise<void> => {
  await tx.delete(documentDates).where(eq(documentDates.documentId, documentId));
  if (rows.length === 0) return;
  await tx.insert(documentDates).values(rows.map((row) => ({ ...row, documentId })));
};
