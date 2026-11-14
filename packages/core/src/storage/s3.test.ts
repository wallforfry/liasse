import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestBucket, type TestBucket } from '../testing/test-bucket.ts';
import { StorageError, StorageObjectNotFoundError } from './errors.ts';
import { createS3Storage } from './s3.ts';
import { bytesOf, describeStorageContract, keyOf } from './contract.test-helper.ts';

describeStorageContract('s3', async () => {
  const bucket = await createTestBucket();
  return { storage: createS3Storage(bucket.options), dispose: bucket.dispose };
});

const listen = (server: Server): Promise<string> =>
  new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address: AddressInfo | string | null = server.address();
      resolve(
        typeof address === 'object' && address !== null
          ? `http://127.0.0.1:${String(address.port)}`
          : '',
      );
    });
  });

describe('s3 storage', () => {
  let bucket: TestBucket;

  beforeAll(async () => {
    bucket = await createTestBucket();
  });

  afterAll(async () => {
    await bucket.dispose();
  });

  it('is refused by the server with a wrong secret', async () => {
    const storage = createS3Storage({ ...bucket.options, secretAccessKey: 'synthetic-wrong' });
    const bytes = bytesOf('synthetic unauthorised file');
    const failure = await storage.put(keyOf(bytes), bytes).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(StorageError);
    expect(failure).not.toBeInstanceOf(StorageObjectNotFoundError);
    expect(String(failure)).not.toContain('synthetic-wrong');
    expect(await createS3Storage(bucket.options).exists(keyOf(bytes))).toBe(false);
  });

  it('reports a bucket that does not exist as a failure, not as an absent file', async () => {
    const storage = createS3Storage({ ...bucket.options, bucket: 'liasse-test-never-created' });
    const bytes = bytesOf('synthetic file for a missing bucket');
    const failure = await storage.put(keyOf(bytes), bytes).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(StorageError);
    expect(failure).not.toBeInstanceOf(StorageObjectNotFoundError);
  });

  it('addresses objects path-style under the configured endpoint', async () => {
    const seen: string[] = [];
    const server = createServer((request, response) => {
      seen.push(`${request.method ?? ''} ${request.url ?? ''}`);
      response.writeHead(200).end();
    });
    const endpoint = await listen(server);
    try {
      const bytes = bytesOf('synthetic path-style file');
      const key = keyOf(bytes);
      const storage = createS3Storage({ ...bucket.options, endpoint: `${endpoint}/` });
      await storage.put(key, bytes);
      expect(seen).toEqual([`PUT /${bucket.options.bucket}/${key}`]);
    } finally {
      server.close();
    }
  });

  it('gives up on a server that never answers', async () => {
    const server = createServer(() => undefined);
    const endpoint = await listen(server);
    try {
      const storage = createS3Storage({ ...bucket.options, endpoint, requestTimeoutMs: 100 });
      await expect(storage.exists(keyOf(bytesOf('synthetic slow file')))).rejects.toBeInstanceOf(
        StorageError,
      );
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });

  it('turns a server error into a storage error naming the status', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(403).end();
    });
    const endpoint = await listen(server);
    try {
      const storage = createS3Storage({ ...bucket.options, endpoint });
      const key = keyOf(bytesOf('synthetic forbidden file'));
      await expect(storage.get(key)).rejects.toThrow('S3 answered 403 to GET');
      await expect(storage.exists(key)).rejects.toThrow('S3 answered 403 to HEAD');
      await expect(storage.delete(key)).rejects.toThrow('S3 answered 403 to DELETE');
    } finally {
      server.close();
    }
  });
});
