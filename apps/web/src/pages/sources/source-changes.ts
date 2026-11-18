import type { Source, SourcePatch } from '@liasse/contract';

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// Keys sorted at every level, a field left out the same as an undefined one.
const canonical = (value: unknown): string | undefined =>
  JSON.stringify(value, (_name, inner: unknown) =>
    isRecord(inner)
      ? Object.fromEntries(Object.entries(inner).toSorted(([a], [b]) => a.localeCompare(b)))
      : inner,
  );

const differs = <Value>(value: Value | undefined, stored: unknown): value is Value =>
  value !== undefined && canonical(value) !== canonical(stored);

/**
 * The fields of `patch` that differ from `source` as the form read it, with the kind and the
 * password, which a patch always names. A field the form left as it was is not sent, so what
 * another tab saved to it in the meantime stays; the configuration is one field.
 */
export const changesOf = (patch: SourcePatch, source: Source): SourcePatch => ({
  kind: patch.kind,
  secret: patch.secret,
  ...(differs(patch.name, source.name) ? { name: patch.name } : {}),
  ...(differs(patch.enabled, source.enabled) ? { enabled: patch.enabled } : {}),
  ...(differs(patch.poll_interval_minutes, source.poll_interval_minutes)
    ? { poll_interval_minutes: patch.poll_interval_minutes }
    : {}),
  ...(differs(patch.hint, source.hint) ? { hint: patch.hint } : {}),
  ...(differs(patch.private, source.private) ? { private: patch.private } : {}),
  ...(differs(patch.config, source.config) ? { config: patch.config } : {}),
});
