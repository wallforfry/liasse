import { notImplemented, type UploadInput } from '@liasse/core/api';
import { z } from 'zod';

// The options of `POST /documents`, as JSON: the file travels base64-encoded.
export const ingestInputSchema = z
  .strictObject({
    file: z.base64().optional().describe('The bytes of the document, base64-encoded.'),
    url: z.url().optional().describe('Not accepted by this server yet.'),
    filename: z.string().min(1).describe('The name of the file, with its extension.'),
    hint: z.string().optional().describe('What the caller knows about the file; free text.'),
    private: z.boolean().optional(),
  })
  .refine(({ file, url }) => (file === undefined) !== (url === undefined), {
    message: 'expected either a file or a url',
  });
export type IngestInput = z.output<typeof ingestInputSchema>;

/**
 * The upload of an `ingest` call. A file named by its URL is refused: fetching an address
 * an agent chose, possibly read from a document, would let the server be steered towards
 * the hosts of its own network.
 */
export const toUpload = ({ file, url: _url, ...options }: IngestInput): UploadInput => {
  if (file === undefined) throw notImplemented('ingestion from a URL');
  return { ...options, bytes: Buffer.from(file, 'base64'), source: 'mcp' };
};
