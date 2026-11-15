import { UPLOAD_FILE_FIELD, UPLOAD_OPTION_FIELDS, type UploadOptions } from '@liasse/contract';

/** A `File` brings its name; a bare `Blob` needs one. */
export type UploadInput = Readonly<UploadOptions> &
  (
    | { readonly file: File; readonly filename?: string | undefined }
    | { readonly file: Blob; readonly filename: string }
  );

export const uploadForm = (input: UploadInput): FormData => {
  const form = new FormData();
  // The union rules out a Blob without a name; FormData would call it "blob".
  form.append(
    UPLOAD_FILE_FIELD,
    input.file,
    input.filename ?? (input.file instanceof File ? input.file.name : 'blob'),
  );
  UPLOAD_OPTION_FIELDS.forEach((field) => {
    const value = input[field];
    if (value !== undefined) form.append(field, String(value));
  });
  return form;
};

export interface DownloadedFile {
  /** The media type the server serves the file as. */
  readonly type: string;
  /** The name it was uploaded under; untrusted, as the file itself. */
  readonly filename: string | null;
  readonly content: Blob;
}

// The server sends the real name percent-encoded beside an ASCII fallback (RFC 6266).
const ENCODED_NAME = /filename\*=UTF-8''([^;]+)/i;

const filenameOf = (disposition: string | null): string | null => {
  const encoded = disposition === null ? undefined : ENCODED_NAME.exec(disposition)?.[1];
  if (encoded === undefined) return null;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
};

export const downloadedFile = async (response: Response): Promise<DownloadedFile> => ({
  type: response.headers.get('Content-Type') ?? 'application/octet-stream',
  filename: filenameOf(response.headers.get('Content-Disposition')),
  content: await response.blob(),
});
