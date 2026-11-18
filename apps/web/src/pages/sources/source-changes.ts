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

const differs = (value: unknown, stored: unknown): boolean =>
  canonical(value) !== canonical(stored);

type SharedField = 'name' | 'enabled' | 'poll_interval_minutes' | 'hint' | 'private';

const sharedChanges = (patch: SourcePatch, source: Source): Pick<SourcePatch, SharedField> => ({
  ...(patch.name !== undefined && differs(patch.name, source.name) ? { name: patch.name } : {}),
  ...(patch.enabled !== undefined && differs(patch.enabled, source.enabled)
    ? { enabled: patch.enabled }
    : {}),
  ...(patch.poll_interval_minutes !== undefined &&
  differs(patch.poll_interval_minutes, source.poll_interval_minutes)
    ? { poll_interval_minutes: patch.poll_interval_minutes }
    : {}),
  ...(patch.hint !== undefined && differs(patch.hint, source.hint) ? { hint: patch.hint } : {}),
  ...(patch.private !== undefined && differs(patch.private, source.private)
    ? { private: patch.private }
    : {}),
});

const configChange = <Config>(config: Config | undefined, stored: unknown) =>
  config !== undefined && differs(config, stored) ? { config } : {};

/**
 * The fields of `patch` that differ from `source` as the form read it, with the kind, and
 * the password of a mailbox, which a patch always names. A field the form left as it was is
 * not sent, so what another tab saved to it in the meantime stays; the configuration is one
 * field. `patch` is of the kind of `source`.
 */
export const changesOf = (patch: SourcePatch, source: Source): SourcePatch =>
  patch.kind === 'imap'
    ? {
        kind: patch.kind,
        secret: patch.secret,
        ...sharedChanges(patch, source),
        ...configChange(patch.config, source.config),
      }
    : {
        kind: patch.kind,
        ...sharedChanges(patch, source),
        ...configChange(patch.config, source.config),
      };
