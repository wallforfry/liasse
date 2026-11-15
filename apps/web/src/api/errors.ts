import { LiasseApiError, LiasseResponseError } from '@liasse/sdk';

export const isUnauthorized = (error: unknown): boolean =>
  error instanceof LiasseApiError && error.status === 401;

/** What to tell the person: the message the server wrote, or what went wrong on the way. */
export const errorMessage = (error: unknown): string => {
  if (error instanceof LiasseApiError) return error.message;
  if (error instanceof LiasseResponseError) {
    return `The server answered in an unexpected way (HTTP ${String(error.status)}).`;
  }
  if (error instanceof TypeError) return 'The server could not be reached.';
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return 'The server took too long to answer.';
  }
  return 'Something went wrong.';
};
