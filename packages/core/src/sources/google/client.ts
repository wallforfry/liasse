import type { Database } from '../../db/client.ts';
import type { SecretBox } from '../../settings/secret-box.ts';
import { readSettings } from '../../settings/store.ts';
import type { GoogleClient } from './oauth.ts';

export type GoogleClientReader = () => Promise<GoogleClient | undefined>;

/**
 * The Google client of the stored settings, read at each call: a save of the settings
 * applies at once to every source, without waiting for the settings to be put in force.
 * Undefined while no client id is saved or its secret does not decrypt.
 */
export const storedGoogleClient =
  (db: Database, secrets: SecretBox): GoogleClientReader =>
  async () => {
    const stored = await readSettings({ db, secrets });
    const clientId = stored?.document.google.client_id;
    const secret = stored?.keys.google;
    if (clientId === undefined || secret?.state !== 'set') return undefined;
    return { clientId, clientSecret: secret.value };
  };
