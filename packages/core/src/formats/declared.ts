import { SUPPORTED_MIMES, type SupportedMime } from '@liasse/contract/domain';

interface Declarations {
  /** The other types a file of the format is declared with, besides its own. */
  readonly aliases: readonly string[];
  readonly extensions: readonly string[];
}

// One entry per type of `SUPPORTED_MIMES`: a type added there does not compile until a
// file listed with it, or named after it, is recognised here.
const DECLARATIONS: Readonly<Record<SupportedMime, Declarations>> = {
  'application/pdf': { aliases: ['application/x-pdf'], extensions: ['pdf'] },
  'image/jpeg': {
    aliases: ['image/jpg', 'image/pjpeg'],
    extensions: ['jpg', 'jpeg', 'jpe', 'jfif'],
  },
  'image/png': { aliases: [], extensions: ['png'] },
  'image/heic': {
    aliases: ['image/heif', 'image/heic-sequence', 'image/heif-sequence'],
    extensions: ['heic', 'heif', 'hif'],
  },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    aliases: [],
    extensions: ['docx'],
  },
  'message/rfc822': { aliases: [], extensions: ['eml'] },
};

const DECLARED_TYPES: ReadonlySet<string> = new Set(
  SUPPORTED_MIMES.flatMap((mime) => [mime, ...DECLARATIONS[mime].aliases]),
);
const DECLARED_EXTENSIONS: ReadonlySet<string> = new Set(
  SUPPORTED_MIMES.flatMap((mime) => DECLARATIONS[mime].extensions),
);

const typeOf = (type: string): string => (type.split(';')[0] ?? '').trim().toLowerCase();
const extensionOf = (name: string): string | undefined =>
  /\.([^.]+)$/.exec(name)?.[1]?.toLowerCase();

/** What a source says of a file before handing over its bytes. */
export interface DeclaredFile {
  readonly name: string;
  /** The media type the source lists it with, when it lists one. */
  readonly type?: string | undefined;
}

/**
 * Whether a file could be of a supported format, from the type a source lists it with or
 * the extension of its name: either one is enough, since a source often lists a generic
 * type (`application/octet-stream`) or names a file without its extension. Its bytes
 * decide afterwards; this only spares the download of a file no format could accept.
 */
export const mayBeSupported = ({ name, type }: DeclaredFile): boolean => {
  if (type !== undefined && DECLARED_TYPES.has(typeOf(type))) return true;
  const extension = extensionOf(name);
  return extension !== undefined && DECLARED_EXTENSIONS.has(extension);
};
