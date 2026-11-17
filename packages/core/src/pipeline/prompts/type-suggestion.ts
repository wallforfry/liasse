import type { SchemaLanguage } from '@liasse/contract/domain';
import { wrapUntrusted } from '../../prompt/untrusted.ts';
import {
  type CandidateLine,
  candidateLine,
  newTypeRules,
  UNTRUSTED_RULE,
} from './classification.ts';

export const typeSuggestionSystemPrompt = (language: SchemaLanguage): string =>
  [
    'You design a document type for a registry, from what a person wrote about the documents it is for.',
    UNTRUSTED_RULE,
    'Define the fields worth reading from every document of the type: the amounts, dates, parties, identifiers and categories a person would search or sort by.',
    ...newTypeRules(language, 'listed type'),
    'Never reuse the slug of a listed type.',
  ].join('\n');

// Descriptions and example titles were written by a model that had read documents, and
// the request by a person: all of it is delimited.
export const typeSuggestionPrompt = (request: string, closest: readonly CandidateLine[]): string =>
  [
    closest.length === 0
      ? 'The registry has no type yet.'
      : `The existing types closest to the request: a possible parent_slug, and types the new one must not duplicate:\n${wrapUntrusted(
          closest.map(candidateLine).join('\n'),
        )}`,
    `What the person wrote about the type they want:\n${wrapUntrusted(request)}`,
  ].join('\n\n');
