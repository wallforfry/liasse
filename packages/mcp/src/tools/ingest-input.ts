import type { IngestRequest } from '@liasse/contract';
import { notImplemented, type UploadInput } from '@liasse/core/api';

/**
 * The upload of an `ingest` call. A file named by its URL is refused: fetching an address
 * an agent chose, possibly read from a document, would let the server be steered towards
 * the hosts of its own network.
 */
export const toUpload = ({ file, url: _url, ...options }: IngestRequest): UploadInput => {
  if (file === undefined) throw notImplemented('ingestion from a URL');
  return { ...options, bytes: Buffer.from(file, 'base64'), source: 'mcp' };
};
