import { EmptyFileError, FileTooLargeError } from './errors.ts';

export type FileContent =
  | { readonly bytes: Uint8Array; readonly stream?: never }
  | { readonly stream: AsyncIterable<Uint8Array>; readonly bytes?: never };

// Leaving the loop by throwing closes the source, so an oversized upload or file is
// dropped after `maxFileSize` bytes instead of being read to its end.
const collect = async (stream: AsyncIterable<Uint8Array>, maxFileSize: number): Promise<Buffer> => {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.byteLength;
    if (size > maxFileSize) throw new FileTooLargeError(maxFileSize);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
};

export const readContent = async (
  content: FileContent,
  maxFileSize: number,
): Promise<Uint8Array> => {
  if (content.bytes !== undefined && content.bytes.byteLength > maxFileSize) {
    throw new FileTooLargeError(maxFileSize);
  }
  const bytes = content.bytes ?? (await collect(content.stream, maxFileSize));
  if (bytes.byteLength === 0) throw new EmptyFileError();
  return bytes;
};
