import { CORE_FIELDS } from '../../registry/core-fields.ts';
import type { RegisteredType } from '../../registry/type-store.ts';
import type { KnowledgeInput } from '../../knowledge/input.ts';
import type { MaskSensitive } from '../deps.ts';
import type { PageText } from '../token-budget.ts';
import { type AssembledSection, assembleSection, entityNamesOf } from './assemble.ts';
import { type MentionDeps, resolveMentions } from './entities.ts';
import {
  entityDetailSchema,
  type ExtractionOutput,
  MAX_SUMMARY_LENGTH,
  MAX_TITLE_LENGTH,
} from './extraction-schema.ts';
import { factEntityNames, readFacts, readNoticePeriod, toKnowledge } from './knowledge.ts';
import { maskQuotes, maskValues } from './masking.ts';
import { createQuoteIndex } from './quotes.ts';
import { languageOf, readOutput } from './read-output.ts';

type Values = Readonly<Record<string, unknown>>;

/** What one extraction call yields once verified, resolved and masked. */
export interface ExtractedDocument {
  readonly core: Values;
  readonly fields: Values;
  readonly extra: Values;
  /** Entries of the values above, by field name. */
  readonly provenance: Values;
  /** The confidence of each kept core value, by field. */
  readonly coreConfidences: Readonly<Record<string, readonly number[]>>;
  /** Core values the model returned that were dropped. */
  readonly rejectedCore: number;
  /** Every value and fact the model returned that was dropped. */
  readonly rejected: number;
  /** Identifiers the model gave for an entity that were not used. */
  readonly droppedIdentifiers: number;
  readonly title: string | null;
  readonly summary: string | null;
  readonly knowledge: KnowledgeInput;
}

export interface ModelAnswer {
  readonly output: ExtractionOutput;
  readonly model: string;
}

export interface InterpretContext {
  readonly type: RegisteredType | undefined;
  /** The pages the model was given: a quote can only come from them. */
  readonly pages: readonly PageText[];
  readonly private: boolean;
}

const without = <Value>(
  record: Readonly<Record<string, Value>>,
  names: readonly string[],
): Readonly<Record<string, Value>> =>
  Object.fromEntries(Object.entries(record).filter(([name]) => !names.includes(name)));

const maskEntries = (mask: MaskSensitive, record: Values): Values =>
  Object.fromEntries(
    Object.entries(record).map(([name, value]) => [name, maskQuotes(mask)(value)]),
  );

interface MaskedSection extends AssembledSection {
  readonly dropped: readonly string[];
}

const maskSection = (mask: MaskSensitive, section: AssembledSection): MaskedSection => {
  const { values, dropped } = maskValues(mask, section.values);
  return {
    values,
    provenance: maskEntries(mask, without(section.provenance, dropped)),
    confidences: without(section.confidences, dropped),
    rejected: section.rejected + dropped.length,
    dropped,
  };
};

// A fact is free text of the model, and it leaves the installation when facts are
// exported. One in which the detector still finds an identifier once masked (two written
// across each other, a masked form that is itself detectable) is not kept.
const isClean = (mask: MaskSensitive, texts: readonly string[]): boolean =>
  texts.every((text) => mask(text) === text);

const maskKnowledge = (mask: MaskSensitive, knowledge: KnowledgeInput): KnowledgeInput => ({
  ...knowledge,
  keyDates: knowledge.keyDates.map((keyDate) => ({
    ...keyDate,
    label: mask(keyDate.label),
    quote: mask(keyDate.quote),
  })),
  facts: knowledge.facts
    .map((fact) => ({
      ...fact,
      text: mask(fact.text),
      quote: mask(fact.quote),
      subjects: fact.subjects.map(mask),
    }))
    .filter(({ text, quote, subjects }) => isClean(mask, [text, quote, ...subjects])),
  subjects: knowledge.subjects.map(({ identifier, ...subject }) => ({
    ...subject,
    name: mask(subject.name),
    ...(identifier === undefined ? {} : { identifier: mask(identifier) }),
  })),
});

const tidyText = (
  mask: MaskSensitive,
  text: string | undefined,
  maxLength: number,
): string | null => {
  const tidy = mask((text ?? '').replace(/\s+/gu, ' ').trim()).slice(0, maxLength);
  return tidy === '' ? null : tidy;
};

/**
 * Turns the output of the model into what may be stored: each value verified against
 * its quote and the registry, each entity name resolved, every sensitive identifier
 * masked. The output triggers nothing else.
 */
export const interpret = async (
  deps: MentionDeps,
  { output, model }: ModelAnswer,
  { type, pages, private: isPrivate }: InterpretContext,
): Promise<ExtractedDocument> => {
  const mask = deps.maskSensitive;
  const typeFields = type?.fields ?? {};
  const trace = { model, schemaVersion: type?.version ?? null };
  const evidence = { quotes: createQuoteIndex(pages), language: languageOf(output) };
  const reading = readOutput(output, typeFields, evidence);
  const facts = readFacts(output, evidence);
  const noticePeriod = readNoticePeriod(output);
  const { resolutions, droppedIdentifiers } = await resolveMentions(
    deps,
    [...entityNamesOf(reading, typeFields), ...factEntityNames(facts)],
    {
      details: (output.entities ?? []).flatMap(
        (raw) => entityDetailSchema.safeParse(raw).data ?? [],
      ),
      documentText: pages.map(({ text }) => text).join('\n'),
      allowExternalEmbedding: !isPrivate,
    },
  );
  const core = maskSection(mask, assembleSection(reading.core, CORE_FIELDS, trace, resolutions));
  const fields = maskSection(mask, assembleSection(reading.fields, typeFields, trace, resolutions));
  const extra = maskSection(mask, assembleSection(reading.extra, {}, trace, resolutions));
  return {
    core: core.values,
    fields: fields.values,
    extra: extra.values,
    provenance: { ...extra.provenance, ...fields.provenance, ...core.provenance },
    coreConfidences: core.confidences,
    rejectedCore: core.rejected,
    rejected:
      core.rejected + fields.rejected + extra.rejected + facts.rejected + noticePeriod.rejected,
    droppedIdentifiers,
    title: tidyText(mask, output.title, MAX_TITLE_LENGTH),
    summary: tidyText(mask, output.summary, MAX_SUMMARY_LENGTH),
    knowledge: maskKnowledge(
      mask,
      toKnowledge(
        output,
        without(reading.core.readings, core.dropped),
        facts,
        noticePeriod,
        trace,
        resolutions,
      ),
    ),
  };
};
