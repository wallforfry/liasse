import { z } from 'zod';
import { API_ERROR_CODES } from './api-errors.ts';

// The body of every failure. No stack, no statement, no file path.
export const errorBodySchema = z.object({
  error: z.looseObject({
    code: z.enum(API_ERROR_CODES).describe('Stable, for programs.'),
    message: z.string().describe('For people; may change.'),
    request_id: z.string(),
  }),
});
export type ErrorBody = z.output<typeof errorBodySchema>;

export const HEALTH_STATUSES = ['ok', 'unavailable'] as const;
export const healthSchema = z.object({ status: z.enum(HEALTH_STATUSES) });
export type Health = z.output<typeof healthSchema>;
