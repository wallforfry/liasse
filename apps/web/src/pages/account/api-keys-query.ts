import { z } from 'zod';
import type { WebAuthClient } from '../../api/auth-client.ts';
import { unwrap } from '../../api/auth-result.ts';

export const API_KEYS_QUERY_KEY = ['api-keys'] as const;

export const deleteApiKey = async (auth: WebAuthClient, keyId: string): Promise<void> => {
  unwrap(z.object({ success: z.literal(true) }), await auth.apiKey.delete({ keyId }));
};
