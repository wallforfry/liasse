import { z } from 'zod';
import { CURRENCY_CODES } from './currencies.ts';
import { LANGUAGE_CODES } from './languages.ts';
import { keyDateKindSchema } from './schemas.ts';

export const isoDateSchema = z.iso.date('expected a calendar date as YYYY-MM-DD');
export type IsoDate = z.output<typeof isoDateSchema>;

// ISO dates sort like the days they denote, so the comparison needs no parsing.
export const periodSchema = z
  .strictObject({ start: isoDateSchema, end: isoDateSchema })
  .refine(({ start, end }) => start <= end, {
    path: ['end'],
    message: 'expected the end of the period on or after its start',
  });
export type Period = z.output<typeof periodSchema>;

const KNOWN_CURRENCIES: ReadonlySet<string> = new Set(CURRENCY_CODES);

// A pattern and a refinement rather than an enum: the JSON Schema given to a model stays
// three lines per amount instead of the whole list.
export const currencyCodeSchema = z
  .string()
  .regex(/^[A-Z]{3}$/, 'expected an ISO 4217 currency code such as EUR')
  .refine((code) => KNOWN_CURRENCIES.has(code), 'expected an ISO 4217 currency code such as EUR');

export const moneySchema = z.strictObject({ value: z.number(), currency: currencyCodeSchema });
export type Money = z.output<typeof moneySchema>;

export const languageCodeSchema = z.enum(LANGUAGE_CODES);

export const keyDateSchema = z.strictObject({
  kind: keyDateKindSchema,
  date: isoDateSchema,
  label: z.string().min(1),
});
export type KeyDate = z.output<typeof keyDateSchema>;
