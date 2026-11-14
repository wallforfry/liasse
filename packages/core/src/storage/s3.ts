import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { StorageError, StorageObjectNotFoundError } from './errors.ts';
import type { StorageKey } from './key.ts';
import type { Storage } from './port.ts';
import {
  checkBucket,
  createSender,
  discard,
  type S3Reply,
  type S3StorageOptions,
  succeeded,
} from './s3-transport.ts';

const sha256Hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

export const createS3Storage = (options: S3StorageOptions): Storage => {
  const send = createSender(options);

  const fetchObject = async (key: StorageKey): Promise<S3Reply> => {
    const reply = await send({ method: 'GET', key });
    if (await succeeded(reply, send)) return reply;
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
      if (!(await succeeded(reply, send))) throw new StorageError('S3 answered 404 to PUT');
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
      const found = await succeeded(reply, send);
      if (found) await discard(reply);
      return found;
    },
    // Deleting an absent object succeeds, with or without a 404, as long as the bucket exists.
    delete: async (key) => {
      const reply = await send({ method: 'DELETE', key });
      if (await succeeded(reply, send)) await discard(reply);
    },
    check: () => checkBucket(send),
  };
};
