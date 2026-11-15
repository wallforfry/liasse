import type { KeyDateKind, LanguageCode, LinkKind, Money } from '@liasse/contract/domain';
import type { PaperName } from '../render/paper.ts';
import type {
  CoreTruth,
  Expectation,
  FactTruth,
  GroundTruth,
  KeyDateTruth,
  LinkTruth,
  Requirement,
  SubjectTruth,
  TruthPrimitive,
  TypeFieldTruth,
} from '../schema/index.ts';

export interface PageSpec {
  readonly lines: readonly string[];
  // The page has no text layer: it is drawn on this paper and stored as a picture.
  readonly scan?: PaperName;
  // Words stamped across a scanned page by whoever filed the paper.
  readonly stamp?: string;
}

export interface Mailbox {
  readonly name: string;
  readonly address: string;
}

// How a document of the scenario becomes a file.
export type RenderSpec =
  | { readonly kind: 'pdf'; readonly pages: readonly PageSpec[] }
  | {
      readonly kind: 'image';
      readonly encoding: 'jpeg' | 'png' | 'heic';
      readonly paper: PaperName;
      readonly lines: readonly string[];
    }
  | { readonly kind: 'docx'; readonly lines: readonly string[] }
  | {
      readonly kind: 'eml';
      readonly from: Mailbox;
      readonly to: Mailbox;
      // RFC 5322 date, written out: the generator has no clock.
      readonly date: string;
      readonly subject: string;
      readonly lines: readonly string[];
      // Documents of the scenario carried by the message, under these file names.
      readonly attachments: readonly { readonly filename: string; readonly document: string }[];
    }
  // The same bytes as another document, under another file name.
  | { readonly kind: 'copy'; readonly of: string };

// What the scenario states of a document; the generator adds what it measures on the file.
export type TruthSpec = Omit<
  GroundTruth,
  'id' | 'description' | 'source' | 'mime' | 'sha256' | 'size' | 'pages'
>;

export interface ScenarioDocument {
  readonly id: string;
  readonly description: string;
  readonly render: RenderSpec;
  readonly truth: TruthSpec;
}

const stated =
  (requirement: 'required' | 'optional') =>
  <Value>(value: Value, quote: string | null, also: readonly Value[] = []): Expectation<Value> => ({
    requirement,
    value,
    quote,
    ...(also.length === 0 ? {} : { also: [...also] }),
  });

// `quote` is what the document prints for the value, null when it is derived; `also`
// lists the other values that are equally right.
export const required = stated('required');
export const optional = stated('optional');

export const FORBIDDEN = { requirement: 'forbidden' } as const;

// A core field the scenario does not mention is one the document does not contain.
export const core = (
  language: LanguageCode,
  found: Partial<Omit<CoreTruth, 'language'>>,
): CoreTruth => ({
  document_date: FORBIDDEN,
  issuer: FORBIDDEN,
  recipient: FORBIDDEN,
  amount: FORBIDDEN,
  period: FORBIDDEN,
  due_date: FORBIDDEN,
  reference: FORBIDDEN,
  ...found,
  language: required(language, null),
});

export const money = (value: number, currency = 'EUR'): Money => ({ value, currency });

export const field = (
  names: readonly string[],
  primitive: TruthPrimitive,
  expectation: Expectation<unknown>,
): TypeFieldTruth => ({ names: [...names], primitive, expectation, masked: false });

// A sensitive identifier: the truth holds the characters that may stay visible.
export const maskedField = (
  names: readonly string[],
  visibleTail: string,
  quote: string,
  requirement: 'required' | 'optional' = 'required',
): TypeFieldTruth => ({
  names: [...names],
  primitive: 'identifier',
  expectation: { requirement, value: visibleTail, quote },
  masked: true,
});

const kindsOf = (kinds: KeyDateKind | readonly KeyDateKind[]): KeyDateKind[] =>
  typeof kinds === 'string' ? [kinds] : [...kinds];

export const keyDate = (
  kinds: KeyDateKind | readonly KeyDateKind[],
  date: string,
  quote: string | null,
  requirement: 'required' | 'optional' = 'required',
): KeyDateTruth => ({ kinds: kindsOf(kinds), expectation: { requirement, value: date, quote } });

export const noKeyDate = (...kinds: readonly KeyDateKind[]): KeyDateTruth => ({
  kinds: [...kinds],
  expectation: FORBIDDEN,
});

export const link = (
  kind: LinkKind,
  target: string,
  requirement: Requirement = 'required',
): LinkTruth => ({ kind, target, requirement });

export const about = (
  subject: { readonly key: string },
  requirement: Requirement = 'required',
): SubjectTruth => ({ subject: subject.key, requirement });

export const fact = (
  statement: string,
  parts: Partial<Omit<FactTruth, 'statement' | 'requirement'>>,
  requirement: FactTruth['requirement'] = 'required',
): FactTruth => ({
  statement,
  requirement,
  entities: [],
  subjects: [],
  dates: [],
  amounts: [],
  ...parts,
});

// The parts of the truth most documents leave empty.
export const truth = (
  stated: Pick<TruthSpec, 'type' | 'core'> & Partial<TruthSpec>,
): TruthSpec => ({
  duplicate_of: null,
  near_duplicate_of: null,
  hard_cases: [],
  fields: [],
  key_dates: [],
  links: [],
  subjects: [],
  facts: [],
  masking: [],
  private: 'forbidden',
  ...stated,
});
