import { isDeepStrictEqual } from 'node:util';
import { AUTO_MERGE_CONFIDENCE, type AutoApplyMode } from '@liasse/contract/domain';
import { ownValue } from '@liasse/contract/registry';
import type { RegisteredType } from '../registry/type-store.ts';

/**
 * Whether a change is applied without approval. `type_changes.auto` records whether the
 * change is safe by the auto-apply policy of the specification; `auto_apply` decides
 * what is done with that: `none` applies nothing, `safe` the safe changes, `all` every
 * change consolidation proposes. A change to the common core is never proposed at all.
 */
export const appliesAutomatically = (mode: AutoApplyMode, auto: boolean): boolean =>
  mode === 'all' || (mode === 'safe' && auto);

/**
 * A mapping loses nothing when every field of the source goes to a field of the target
 * with the same definition, and no two fields of the source go to the same one.
 */
export const isLosslessMapping = (
  source: RegisteredType,
  target: RegisteredType,
  mapping: Readonly<Record<string, string | null>>,
): boolean => {
  const destinations = Object.keys(source.fields).map((field) => ownValue(mapping, field) ?? null);
  return (
    new Set(destinations).size === destinations.length &&
    Object.entries(source.fields).every(([field, definition]) => {
      const destination = ownValue(mapping, field) ?? null;
      return (
        destination !== null && isDeepStrictEqual(ownValue(target.fields, destination), definition)
      );
    })
  );
};

/** A merge of two provisional types, sure enough and lossless, needs no approval. */
export const isSafeMerge = (
  source: RegisteredType,
  target: RegisteredType,
  mapping: Readonly<Record<string, string | null>>,
  confidence: number,
): boolean =>
  source.status === 'provisional' &&
  target.status === 'provisional' &&
  confidence >= AUTO_MERGE_CONFIDENCE &&
  isLosslessMapping(source, target, mapping);
