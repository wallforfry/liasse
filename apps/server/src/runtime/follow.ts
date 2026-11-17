import type { SettingsContext } from '@liasse/core/api';
import {
  readSettings,
  SETTINGS_CHANNEL,
  settingsOf,
  type StoredSettings,
  unreadableSlots,
} from '@liasse/core/settings';
import { describeError, type Logger } from '../log.ts';
import type { ShutdownStep } from '../shutdown.ts';
import type { LiveRuntime } from './live.ts';

/** Said while a stored key does not decrypt: names the section, never the key. */
export const unreadableNotice = (stored: StoredSettings): string =>
  `Notice: the key of the ${unreadableSlots(stored.keys).join(', ')} settings does not ` +
  'decrypt: AUTH_SECRET changed since it was saved. Liasse processes nothing until it is ' +
  'replaced or cleared with PUT /settings, or AUTH_SECRET is restored.';

/**
 * Puts the stored settings in force when they are newer than those of this process, unless
 * a key does not decrypt, which `notice` reports. Resolves to what is stored.
 */
export const applyStored = async (
  settings: SettingsContext,
  live: Pick<LiveRuntime, 'prepare' | 'version'>,
  notice: (line: string) => void,
): Promise<StoredSettings | undefined> => {
  const stored = await readSettings(settings);
  if (stored === undefined || stored.version <= live.version()) return stored;
  const document = settingsOf(stored);
  if (document === undefined) {
    notice(unreadableNotice(stored));
    return stored;
  }
  const parts = await live.prepare(document, stored.version);
  parts.putInForce();
  await parts.settle();
  return stored;
};

const LISTEN_REFUSED =
  'Notice: the database refused LISTEN, as a transaction pooler does: settings saved by ' +
  'another process apply here only after a restart.';

/**
 * Follows the settings other processes save: every save notifies its version, and every
 * (re)connection of the listener reads the stored version again, for a save missed while it
 * was down. One reading at a time; a failed one is reported, and the next notification
 * tries again.
 */
export const followSettings = async (
  settings: SettingsContext,
  live: Pick<LiveRuntime, 'prepare' | 'version'>,
  logger: Logger,
): Promise<ShutdownStep> => {
  let reading: Promise<void> = Promise.resolve();
  const refresh = (): void => {
    reading = reading
      .then(async () => {
        await applyStored(settings, live, logger.notice);
      })
      .catch((error: unknown) => {
        logger.event('settings_follow_failed', describeError(error));
      });
  };
  const subscription = await settings.db.$client
    .listen(SETTINGS_CHANNEL, refresh, refresh)
    .catch((error: unknown) => {
      logger.event('settings_follow_failed', describeError(error));
      logger.notice(LISTEN_REFUSED);
      return undefined;
    });
  return {
    name: 'settings follower',
    run: async () => {
      await subscription?.unlisten();
      await reading;
    },
  };
};
