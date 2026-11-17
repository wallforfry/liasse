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

export interface ApplyOptions {
  /** At startup, a failing startup task stops the start; later, it is retried. */
  readonly atBoot?: boolean;
}

/**
 * Puts the stored settings in force when they are newer than those of this process, unless
 * a key does not decrypt, which `notice` reports. Resolves to what is stored.
 */
export const applyStored = async (
  settings: SettingsContext,
  live: Pick<LiveRuntime, 'prepare' | 'version'>,
  notice: (line: string) => void,
  { atBoot = false }: ApplyOptions = {},
): Promise<StoredSettings | undefined> => {
  const stored = await readSettings(settings);
  if (stored === undefined || stored.version <= live.version()) return stored;
  const document = settingsOf(stored);
  if (document === undefined) {
    notice(unreadableNotice(stored));
    return stored;
  }
  const parts = await live.prepare(document, stored.version, { atBoot });
  parts.putInForce();
  await parts.settle();
  return stored;
};

const LISTEN_REFUSED =
  'Notice: the database refused LISTEN, as a transaction pooler does: settings saved by ' +
  'another process apply here only when a job queued under them is claimed, or after a ' +
  'restart.';

export const FOLLOW_RETRY = { firstMs: 500, maxMs: 30_000 } as const;

export interface SettingsFollower {
  /** Reads the stored settings, after the reading in progress, and applies newer ones. */
  readonly catchUp: () => Promise<void>;
  /** Listens for saves and reconnections. Resolves to the step that stops following. */
  readonly start: () => Promise<ShutdownStep>;
}

/**
 * Follows the settings other processes save: every save notifies its version, and every
 * (re)connection of the listener reads the stored version again, for a save missed while it
 * was down. One reading at a time; a failed one is reported and tried again, with a delay
 * that doubles up to `FOLLOW_RETRY.maxMs`, until one succeeds or the follower stops.
 */
export const createSettingsFollower = (
  settings: SettingsContext,
  live: Pick<LiveRuntime, 'prepare' | 'version'>,
  logger: Logger,
): SettingsFollower => {
  let reading: Promise<void> = Promise.resolve();
  let retry: NodeJS.Timeout | undefined;
  let delayMs: number = FOLLOW_RETRY.firstMs;
  let stopped = false;

  const read = async (): Promise<void> => {
    try {
      await applyStored(settings, live, logger.notice);
      delayMs = FOLLOW_RETRY.firstMs;
    } catch (error) {
      logger.event('settings_follow_failed', describeError(error));
      if (stopped || retry !== undefined) return;
      retry = setTimeout(() => {
        retry = undefined;
        void catchUp();
      }, delayMs);
      delayMs = Math.min(delayMs * 2, FOLLOW_RETRY.maxMs);
    }
  };

  const catchUp = (): Promise<void> => {
    reading = reading.then(read);
    return reading;
  };

  const start = async (): Promise<ShutdownStep> => {
    const refresh = (): void => {
      void catchUp();
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
        stopped = true;
        clearTimeout(retry);
        await subscription?.unlisten();
        await reading;
      },
    };
  };

  return { catchUp, start };
};
