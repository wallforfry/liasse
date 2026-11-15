/** A timestamp of the API, to the minute, in UTC as the server records it. */
export const formatTime = (iso: string): string => `${iso.slice(0, 16).replace('T', ' ')} UTC`;

/** A value read from a document, shown as text: a string as it is, anything else as JSON. */
export const shownValue = (value: unknown): string =>
  typeof value === 'string' ? value : JSON.stringify(value);

/** `needs_review` as `needs review`. */
export const statusLabel = (status: string): string => status.replaceAll('_', ' ');

export const plural = (count: number, noun: string): string =>
  `${String(count)} ${noun}${count === 1 ? '' : 's'}`;
