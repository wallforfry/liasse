// The watchdog thread cannot use the IPC channel, which belongs to the main thread it
// watches. It writes why it ends the process on this descriptor, the fifth entry of the
// `stdio` the parent forks with.
export const VERDICT_FD = 4;

export const WATCHDOG_VERDICTS = ['memory', 'cpu'] as const;
export type WatchdogVerdict = (typeof WATCHDOG_VERDICTS)[number];

// What the watchdog tells the main thread of its process once it has taken its first
// sample: from then on the limits hold.
export const WATCHING = 'watching';
