import { AwsClient } from 'aws4fetch';
import { StorageError, StorageMisconfiguredError } from './errors.ts';
import type { StorageKey } from './key.ts';

export interface S3StorageOptions {
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly region?: string | undefined;
  /** Any S3-compatible server. Objects are then addressed path-style. */
  readonly endpoint?: string | undefined;
  /** Deadline of a request without payload, and the fixed part of an upload's. */
  readonly requestTimeoutMs?: number | undefined;
  /** The slowest upload still accepted: each payload byte extends the deadline by its share. */
  readonly minUploadBytesPerSecond?: number | undefined;
}

export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
export const DEFAULT_MIN_UPLOAD_BYTES_PER_SECOND = 64 * 1024;
const DEFAULT_REGION = 'us-east-1';
const TRANSIENT_FAILURE_RETRIES = 3;
const NOT_FOUND = 404;
const REFUSED = [401, 403];

export type Method = 'PUT' | 'GET' | 'HEAD' | 'DELETE';

export interface S3Request {
  readonly method: Method;
  /** Left out, the request addresses the bucket itself. */
  readonly key?: StorageKey;
  readonly body?: Uint8Array;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface S3Reply {
  readonly method: Method;
  readonly response: Response;
  /** Ends the deadline once the caller has read what it needs. */
  readonly settle: () => void;
}

const bucketUrl = ({ bucket, endpoint, region }: S3StorageOptions): string =>
  endpoint === undefined
    ? `https://${bucket}.s3.${region ?? DEFAULT_REGION}.amazonaws.com`
    : `${endpoint.replace(/\/+$/, '')}/${bucket}`;

export const createSender = (options: S3StorageOptions) => {
  const client = new AwsClient({
    accessKeyId: options.accessKeyId,
    secretAccessKey: options.secretAccessKey,
    region: options.region ?? DEFAULT_REGION,
    service: 's3',
    retries: TRANSIENT_FAILURE_RETRIES,
  });
  const baseUrl = bucketUrl(options);
  const baseTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const minUploadRate = options.minUploadBytesPerSecond ?? DEFAULT_MIN_UPLOAD_BYTES_PER_SECOND;

  // A fixed deadline would refuse every large file on a slow link, again at each
  // retry: the payload buys its own time at the slowest rate still accepted.
  const deadlineMs = (body: Uint8Array | undefined): number =>
    baseTimeoutMs + ((body?.byteLength ?? 0) / minUploadRate) * 1000;

  return async ({ method, key, body, headers }: S3Request): Promise<S3Reply> => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, deadlineMs(body));
    const settle = (): void => {
      clearTimeout(timer);
    };
    try {
      const response = await client.fetch(key === undefined ? baseUrl : `${baseUrl}/${key}`, {
        method,
        signal: controller.signal,
        ...(body === undefined ? {} : { body }),
        ...(headers === undefined ? {} : { headers }),
      });
      return { method, response, settle };
    } catch (error) {
      settle();
      throw new StorageError(`The S3 ${method} request did not complete`, { cause: error });
    }
  };
};

export type S3Sender = ReturnType<typeof createSender>;

// An unread body keeps its connection busy.
export const discard = async ({ response, settle }: S3Reply): Promise<void> => {
  try {
    await response.body?.cancel();
  } finally {
    settle();
  }
};

const missingBucket = (): StorageMisconfiguredError =>
  new StorageMisconfiguredError('The S3 bucket of the file storage does not exist');

/**
 * Why a request was answered 404. S3 uses the same status for a missing object and for
 * a missing bucket and tells them apart in the body only; a HEAD has no body, so the
 * bucket is asked directly. A missing bucket rejects: it must never read as "no such
 * file", which for a deletion would look like success.
 */
const rejectMissingBucket = async (reply: S3Reply, send: S3Sender): Promise<void> => {
  if (reply.method === 'HEAD') {
    await discard(reply);
    await checkBucket(send);
    return;
  }
  const body = await reply.response.text().finally(reply.settle);
  if (body.includes('<Code>NoSuchBucket</Code>')) throw missingBucket();
};

/** Resolves to true for a success and to false for a missing object; rejects otherwise. */
export const succeeded = async (reply: S3Reply, send: S3Sender): Promise<boolean> => {
  if (reply.response.ok) return true;
  if (reply.response.status === NOT_FOUND) {
    await rejectMissingBucket(reply, send);
    return false;
  }
  await discard(reply);
  throw new StorageError(`S3 answered ${String(reply.response.status)} to ${reply.method}`);
};

export const checkBucket = async (send: S3Sender): Promise<void> => {
  const reply = await send({ method: 'HEAD' });
  await discard(reply);
  const { status, ok } = reply.response;
  if (ok) return;
  if (status === NOT_FOUND) throw missingBucket();
  if (REFUSED.includes(status)) {
    throw new StorageMisconfiguredError(
      'The S3 server refused the credentials of the file storage, or they give no access to its bucket',
    );
  }
  throw new StorageError(`S3 answered ${String(status)} to HEAD on the bucket`);
};
