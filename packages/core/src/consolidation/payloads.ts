import type { ChangeKind } from '@liasse/contract/domain';
import { fieldDefinitionSchema } from '@liasse/contract/registry';
import { z } from 'zod';
import { mergeEntityPayloadSchema } from '../entities/proposal-store.ts';

const id = z.string().min(1);
const name = z.string().min(1);

// `field_mapping` names, for each field of the source, the field of the target its values
// go to, or null when the target has none: such values go to `extra`.
export const mergePayloadSchema = z.strictObject({
  source_id: id,
  target_id: id,
  field_mapping: z.record(name, name.nullable()),
  confidence: z.number().min(0).max(1),
});
export type MergePayload = z.output<typeof mergePayloadSchema>;

// `variants` are the keys of `extra` whose values become the field. `retype` says the
// type already has a field of that name with another definition, which the change
// replaces: a retyping, never applied without approval under `AUTO_APPLY=safe`.
export const promoteFieldPayloadSchema = z.strictObject({
  type_id: id,
  field: name,
  definition: fieldDefinitionSchema,
  variants: z.array(name).min(1),
  retype: z.boolean(),
});
export type PromoteFieldPayload = z.output<typeof promoteFieldPayloadSchema>;

export const stabilizePayloadSchema = z.strictObject({ type_id: id });
export type StabilizePayload = z.output<typeof stabilizePayloadSchema>;

export const removeFieldPayloadSchema = z.strictObject({ type_id: id, field: name });
export type RemoveFieldPayload = z.output<typeof removeFieldPayloadSchema>;

/** The kinds consolidation proposes and applies. */
export type ConsolidationChange =
  | { readonly kind: 'merge'; readonly payload: MergePayload }
  | { readonly kind: 'promote_field'; readonly payload: PromoteFieldPayload }
  | { readonly kind: 'stabilize'; readonly payload: StabilizePayload }
  | { readonly kind: 'remove_field'; readonly payload: RemoveFieldPayload }
  | {
      readonly kind: 'merge_entity' | 'merge_subject';
      readonly payload: z.output<typeof mergeEntityPayloadSchema>;
    };

/**
 * Reads a stored payload by its kind. Undefined for a kind nothing applies (`split`,
 * `rename`), or for a payload that does not match its kind: neither can be applied.
 */
export const readChange = (kind: ChangeKind, payload: unknown): ConsolidationChange | undefined => {
  const parse = <T>(schema: z.ZodType<T>) => {
    const parsed = schema.safeParse(payload);
    return parsed.success ? parsed.data : undefined;
  };
  switch (kind) {
    case 'merge': {
      const read = parse(mergePayloadSchema);
      return read === undefined ? undefined : { kind, payload: read };
    }
    case 'promote_field': {
      const read = parse(promoteFieldPayloadSchema);
      return read === undefined ? undefined : { kind, payload: read };
    }
    case 'stabilize': {
      const read = parse(stabilizePayloadSchema);
      return read === undefined ? undefined : { kind, payload: read };
    }
    case 'remove_field': {
      const read = parse(removeFieldPayloadSchema);
      return read === undefined ? undefined : { kind, payload: read };
    }
    case 'merge_entity':
    case 'merge_subject': {
      const read = parse(mergeEntityPayloadSchema);
      return read === undefined ? undefined : { kind, payload: read };
    }
    case 'split':
    case 'rename':
      return undefined;
  }
};
