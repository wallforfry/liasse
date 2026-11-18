/**
 * A file that ingestion refuses for what it is: trying it again cannot succeed. Each
 * refusal is a subclass, which the API answers with a code of its own.
 */
export abstract class IngestError extends Error {
  override readonly name: string = 'IngestError';
}

export class FileTooLargeError extends IngestError {
  override readonly name = 'FileTooLargeError';
  readonly maxFileSize: number;

  constructor(maxFileSize: number) {
    super(`The file is larger than the limit of ${String(maxFileSize)} bytes`);
    this.maxFileSize = maxFileSize;
  }
}

export class EmptyFileError extends IngestError {
  override readonly name = 'EmptyFileError';

  constructor() {
    super('The file is empty');
  }
}

export class UnsupportedFormatError extends IngestError {
  override readonly name = 'UnsupportedFormatError';

  constructor() {
    super('The file is not a PDF, a JPEG, PNG or HEIC image, a DOCX document or an email');
  }
}
