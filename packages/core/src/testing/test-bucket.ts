import { randomBytes } from 'node:crypto';
import { AwsClient } from 'aws4fetch';
import type { S3StorageOptions } from '../storage/s3-transport.ts';

// These match the `s3` service of docker-compose.dev.yml and of the CI workflow.
export const DEFAULT_TEST_S3_ENDPOINT = 'http://127.0.0.1:54330';
const TEST_S3_ACCESS_KEY_ID = 'liasse';
const TEST_S3_SECRET_ACCESS_KEY = 'liasse-secret';
const TEST_S3_REGION = 'us-east-1';

const REQUEST_TIMEOUT_MS = 10_000;

export interface TestBucket {
  readonly options: S3StorageOptions;
  readonly dispose: () => Promise<void>;
}

// One throwaway bucket per caller, like `createTestDatabase`. An unreachable server
// rejects here, which fails the calling test.
export const createTestBucket = async (): Promise<TestBucket> => {
  const endpoint = process.env.TEST_S3_ENDPOINT ?? DEFAULT_TEST_S3_ENDPOINT;
  const bucket = `liasse-test-${randomBytes(8).toString('hex')}`;
  const client = new AwsClient({
    accessKeyId: TEST_S3_ACCESS_KEY_ID,
    secretAccessKey: TEST_S3_SECRET_ACCESS_KEY,
    region: TEST_S3_REGION,
    service: 's3',
    retries: 0,
  });
  const call = async (method: string, path: string): Promise<string> => {
    const response = await client.fetch(`${endpoint}/${bucket}${path}`, {
      method,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(`The test S3 server answered ${String(response.status)} to ${method}`);
    }
    return body;
  };

  await call('PUT', '');
  return {
    options: {
      bucket,
      endpoint,
      region: TEST_S3_REGION,
      accessKeyId: TEST_S3_ACCESS_KEY_ID,
      secretAccessKey: TEST_S3_SECRET_ACCESS_KEY,
    },
    dispose: async () => {
      const listing = await call('GET', '?list-type=2');
      const keys = [...listing.matchAll(/<Key>([^<]+)<\/Key>/g)].flatMap(([, key]) =>
        key === undefined ? [] : [key],
      );
      await Promise.all(keys.map((key) => call('DELETE', `/${key}`)));
      await call('DELETE', '');
    },
  };
};
