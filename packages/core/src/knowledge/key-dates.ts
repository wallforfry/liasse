import type { KeyDate, KeyDateKind } from '@liasse/contract/domain';
import { eq } from 'drizzle-orm';
import { documentDates } from '../db/schema/knowledge.ts';
import { redactSensitiveIdentifiers } from '../entities/detect-sensitive.ts';
import type { EntityTransaction } from '../entities/entity-store.ts';
import type { KnowledgeKeyDate, NoticePeriod } from './input.ts';
import { subtractPeriod } from './notice-deadline.ts';

// A row of `document_dates` without its document. A date Liasse computed has no model, no
// page and no quote, and is not manual: that is what marks it as computed.
export interface KeyDateRow {
  readonly kind: KeyDateKind;
  readonly date: string;
  readonly label: string;
  readonly model: string | null;
  readonly schemaVersion: number | null;
  readonly page: number | null;
  readonly quote: string | null;
  readonly confidence: number | null;
  readonly manual: boolean;
}

type RenewalDate = Pick<KeyDateRow, 'date' | 'label' | 'schemaVersion' | 'confidence'>;

const NOTICE_DEADLINE = 'notice_deadline' satisfies KeyDateKind;
const RENEWAL = 'renewal' satisfies KeyDateKind;

const describePeriod = ({ amount, unit }: NoticePeriod): string =>
  `${String(amount)} ${amount === 1 ? unit.slice(0, -1) : unit}`;

// The deadline rests on two values, and is as sure as the less sure of them: a renewal
// date a person gave counts as sure.
const noticeDeadline = (renewal: RenewalDate, period: NoticePeriod): readonly KeyDateRow[] => {
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
          confidence: Math.min(renewal.confidence ?? 1, period.confidence),
          manual: false,
        },
      ];
};

const computedDeadlines = (
  renewals: readonly RenewalDate[],
  noticePeriod: NoticePeriod | undefined,
): readonly KeyDateRow[] =>
  noticePeriod === undefined
    ? []
    : renewals.flatMap((renewal) => noticeDeadline(renewal, noticePeriod));

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
  const computed = computedDeadlines(
    keyDates.filter(({ kind }) => kind === RENEWAL),
    noticePeriod,
  );
  const extracted = keyDates
    .filter(({ kind }) => computed.length === 0 || kind !== NOTICE_DEADLINE)
    .map((keyDate) => ({
      ...keyDate,
      quote: redactSensitiveIdentifiers(keyDate.quote),
      manual: false,
    }));
  return withoutRepeats(
    [...extracted, ...computed].map((row) => ({
      ...row,
      label: redactSensitiveIdentifiers(row.label),
    })),
  );
};

/**
 * The rows of the key dates a person gave, each as given, with no model, page or quote.
 * The notice deadline of each renewal date is computed from the notice period the
 * extraction read, unless the person gave a notice deadline themselves: their date then
 * stands, so the rows always hold the dates of `core.key_dates`. The labels are those of
 * the core, masked when it was written.
 */
export const planManualKeyDates = (
  keyDates: readonly KeyDate[],
  noticePeriod: NoticePeriod | undefined,
): readonly KeyDateRow[] => {
  const given = keyDates.map(({ kind, date, label }): KeyDateRow => ({
    kind,
    date,
    label,
    model: null,
    schemaVersion: null,
    page: null,
    quote: null,
    confidence: null,
    manual: true,
  }));
  const typed = keyDates.some(({ kind }) => kind === NOTICE_DEADLINE);
  const computed = typed
    ? []
    : computedDeadlines(
        given.filter(({ kind }) => kind === RENEWAL),
        noticePeriod,
      );
  return withoutRepeats([...given, ...computed]);
};

/**
 * Whether key dates a person gives type a notice deadline that the rules compute: they
 * hold a renewal date and the document a notice period. The typed date would contradict
 * the computed one, or repeat it.
 */
export const typesComputedNoticeDeadline = (
  keyDates: readonly KeyDate[],
  noticePeriod: NoticePeriod | undefined,
): boolean =>
  keyDates.some(({ kind }) => kind === NOTICE_DEADLINE) &&
  planManualKeyDates(
    keyDates.filter(({ kind }) => kind === RENEWAL),
    noticePeriod,
  ).some(({ kind }) => kind === NOTICE_DEADLINE);

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
