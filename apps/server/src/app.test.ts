import { createDb } from '@liasse/core/db';
import { createTestDatabase } from '@liasse/core/testing';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.ts';

describe('GET /health', () => {
  it('answers ok when the database answers', async () => {
    const database = await createTestDatabase({ migrate: false });
    try {
      const response = await createApp({ database }).request('/health');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: 'ok' });
    } finally {
      await database.dispose();
    }
  });

  it('answers 503 when the database does not answer', async () => {
    const database = createDb('postgres://liasse:liasse@127.0.0.1:1/liasse');
    try {
      const response = await createApp({ database }).request('/health');
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ status: 'unavailable' });
    } finally {
      await database.close();
    }
  });
});
