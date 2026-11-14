import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { AwsClient } from 'aws4fetch';
import { StorageError, StorageObjectNotFoundError } from './errors.ts';
import type { StorageKey } from './key.ts';
import type { Storage } from './port.ts';

export interface S3StorageOptions {
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly region?: string | undefined;
  /** Any S3-compatible server. Objects are then addressed path-style. */
  readonly endpoint?: string | undefined;
  readonly requestTimeoutMs?: number;
}

const DEFAULT_REGION = 'us-east-1';
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const TRANSIENT_FAILURE_RETRIES = 3;
const NOT_FOUND = 404;

type Method = 'PUT' | 'GET' | 'HEAD' | 'DELETE';

interface S3Request {
  readonly method: Method;
  readonly key: StorageKey;
  readonly body?: Uint8Array;
  readonly headers?: Readonly<Record<string, string>>;
}

interface S3Reply {
  readonly response: Response;
  /** Ends the deadline once the caller has read what it needs. */
  readonly settle: () => void;
}

const bucketUrl = ({ bucket, endpoint, region }: S3StorageOptions): string =>
  endpoint === undefined
    ? `https://${bucket}.s3.${region ?? DEFAULT_REGION}.amazonaws.com`
    : `${endpoint.replace(/\/+$/, '')}/${bucket}`;

const sha256Hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

const createSender = (options: S3StorageOptions) => {
  const client = new AwsClient({
    accessKeyId: options.accessKeyId,
    secretAccessKey: options.secretAccessKey,
    region: options.region ?? DEFAULT_REGION,
    service: 's3',
    retries: TRANSIENT_FAILURE_RETRIES,
  });
  const baseUrl = bucketUrl(options);
  const timeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

  return async ({ method, key, body, headers }: S3Request): Promise<S3Reply> => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    const settle = (): void => {
      clearTimeout(timer);
    };
    try {
      const response = await client.fetch(`${baseUrl}/${key}`, {
        method,
        signal: controller.signal,
        ...(body === undefined ? {} : { body }),
        ...(headers === undefined ? {} : { headers }),
      });
      return { response, settle };
    } catch (error) {
      settle();
      throw new StorageError(`The S3 ${method} request did not complete`, { cause: error });
    }
  };
};

// An unread body keeps its connection busy.
const discard = async ({ response, settle }: S3Reply): Promise<void> => {
  try {
    await response.body?.cancel();
  } finally {
    settle();
  }
};

const rejectStatus = async (reply: S3Reply, method: Method): Promise<never> => {
  await discard(reply);
  throw new StorageError(`S3 answered ${String(reply.response.status)} to ${method}`);
};

export const createS3Storage = (options: S3StorageOptions): Storage => {
  const send = createSender(options);

  const fetchObject = async (key: StorageKey): Promise<S3Reply> => {
    const reply = await send({ method: 'GET', key });
    if (reply.response.ok) return reply;
    if (reply.response.status !== NOT_FOUND) return rejectStatus(reply, 'GET');
    await discard(reply);
    throw new StorageObjectNotFoundError();
  };

  return {
    put: async (key, bytes) => {
      // Declaring the payload hash makes the server reject bytes altered in transit.
      const reply = await send({
        method: 'PUT',
        key,
        body: bytes,
        headers: { 'x-amz-content-sha256': sha256Hex(bytes) },
      });
      if (!reply.response.ok) await rejectStatus(reply, 'PUT');
      await discard(reply);
    },
    get: async (key) => {
      const { response, settle } = await fetchObject(key);
      try {
        return new Uint8Array(await response.arrayBuffer());
      } catch (error) {
        throw new StorageError('The S3 GET response was interrupted', { cause: error });
      } finally {
        settle();
      }
    },
    // The deadline covers the response headers only: the consumer sets the pace of the body.
    getStream: async (key) => {
      const { response, settle } = await fetchObject(key);
      settle();
      if (response.body === null) throw new StorageError('S3 answered GET without a body');
      return Readable.fromWeb(response.body);
    },
    exists: async (key) => {
      const reply = await send({ method: 'HEAD', key });
      if (reply.response.ok) {
        await discard(reply);
        return true;
      }
      if (reply.response.status === NOT_FOUND) {
        await discard(reply);
        return false;
      }
      return rejectStatus(reply, 'HEAD');
    },
    delete: async (key) => {
      const reply = await send({ method: 'DELETE', key });
      if (!reply.response.ok && reply.response.status !== NOT_FOUND) {
        await rejectStatus(reply, 'DELETE');
      }
      await discard(reply);
    },
  };
};
