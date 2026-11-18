import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { waitUntil } from '../testing/async.ts';
import { createTestBucket, type TestBucket } from '../testing/test-bucket.ts';
import { StorageError, StorageMisconfiguredError, StorageObjectNotFoundError } from './errors.ts';
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

  it('reports a bucket that does not exist as a misconfiguration, on every operation', async () => {
    const storage = createS3Storage({ ...bucket.options, bucket: 'liasse-test-never-created' });
    const bytes = bytesOf('synthetic file for a missing bucket');
    const key = keyOf(bytes);
    await expect(storage.put(key, bytes)).rejects.toBeInstanceOf(StorageMisconfiguredError);
    await expect(storage.get(key)).rejects.toBeInstanceOf(StorageMisconfiguredError);
    await expect(storage.getStream(key)).rejects.toBeInstanceOf(StorageMisconfiguredError);
    await expect(storage.exists(key)).rejects.toBeInstanceOf(StorageMisconfiguredError);
    await expect(storage.delete(key)).rejects.toBeInstanceOf(StorageMisconfiguredError);
    await expect(storage.check()).rejects.toBeInstanceOf(StorageMisconfiguredError);
  });

  it('passes its startup check on a reachable bucket', async () => {
    await expect(createS3Storage(bucket.options).check()).resolves.toBeUndefined();
  });

  it('fails its startup check on refused credentials, without echoing them', async () => {
    const storage = createS3Storage({ ...bucket.options, secretAccessKey: 'synthetic-wrong' });
    const failure = await storage.check().then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(StorageMisconfiguredError);
    expect(String(failure)).not.toContain('synthetic-wrong');
  });

  it('fails its startup check on a server it cannot reach', async () => {
    const storage = createS3Storage({ ...bucket.options, endpoint: 'http://127.0.0.1:9' });
    await expect(storage.check()).rejects.toBeInstanceOf(StorageError);
  });

  // The server answers the large upload only once the small one, whose deadline was armed
  // after it, gave up: with the deadline of the small one, the large one would have given up
  // first. Its own deadline, 100 s, outlasts the test, so how fast the server answers it
  // decides nothing.
  it('gives an upload a deadline that grows with its size', async ({ signal }) => {
    const held = new Map<string, () => void>();
    const server = createServer((request, response) => {
      request.resume().on('end', () => {
        held.set(request.url ?? '', () => response.writeHead(200).end());
      });
    });
    const endpoint = await listen(server);
    try {
      const storage = createS3Storage({
        ...bucket.options,
        endpoint,
        requestTimeoutMs: 100,
        minUploadBytesPerSecond: 1000,
      });
      const large = new Uint8Array(100_000).fill(7);
      const largeUpload = storage.put(keyOf(large), large);
      const small = bytesOf('synthetic small upload');
      await expect(storage.put(keyOf(small), small)).rejects.toBeInstanceOf(StorageError);
      const largeUrl = `/${bucket.options.bucket}/${keyOf(large)}`;
      await waitUntil(() => held.has(largeUrl), { signal });
      held.get(largeUrl)?.();
      await expect(largeUpload).resolves.toBeUndefined();
    } finally {
      server.closeAllConnections();
      server.close();
    }
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
