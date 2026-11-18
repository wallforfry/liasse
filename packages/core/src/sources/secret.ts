import type { SecretUpdate } from '@liasse/contract';
import type { StoredKey } from '../settings/keys.ts';
import { type SecretBox, SettingsSecretError } from '../settings/secret-box.ts';

// The slot binds a sealed secret to its row: copied onto another source, it does not open.
const slotOf = (sourceId: string): string => `source:${sourceId}`;

/** The secret of a source, opened; unreadable when sealed under another AUTH_SECRET. */
export const openSourceSecret = (
  secrets: SecretBox,
  sourceId: string,
  sealed: string | null,
): StoredKey => {
  if (sealed === null) return { state: 'unset' };
  try {
    return { state: 'set', value: secrets.open(slotOf(sourceId), sealed) };
  } catch (error) {
    if (error instanceof SettingsSecretError) return { state: 'unreadable' };
    throw error;
  }
};

/** The sealed value a source stores after `update`, from the one it stored. */
export const updateSourceSecret = (
  secrets: SecretBox,
  sourceId: string,
  sealed: string | null,
  update: SecretUpdate,
): string | null => {
  switch (update.action) {
    case 'keep':
      return sealed;
    case 'replace':
      return secrets.seal(slotOf(sourceId), update.value);
    case 'clear':
      return null;
  }
};
