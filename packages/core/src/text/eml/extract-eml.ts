import type { Address, Attachment, Email } from 'postal-mime';
import { TextExtractionError } from '../errors.ts';
import { normalizeText } from '../normalize.ts';
import type { ExtractedAttachment, ExtractedText } from '../types.ts';
import { htmlToText } from './html-to-text.ts';

const loadParser = () => import('postal-mime');

const formatAddress = (address: Address): string => {
  if (address.group !== undefined) {
    return `${address.name}: ${address.group.map(formatAddress).join(', ')};`;
  }
  return address.name === '' ? address.address : `${address.name} <${address.address}>`;
};

const formatAddresses = (addresses: readonly Address[] | undefined): string | undefined =>
  addresses === undefined || addresses.length === 0
    ? undefined
    : addresses.map(formatAddress).join(', ');

const headerBlock = (email: Email): string =>
  [
    ['From', email.from === undefined ? undefined : formatAddress(email.from)],
    ['To', formatAddresses(email.to)],
    ['Cc', formatAddresses(email.cc)],
    ['Date', email.date],
    ['Subject', email.subject],
  ]
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([label, value]) => `${label ?? ''}: ${value ?? ''}`)
    .join('\n');

const toBytes = (content: Attachment['content']): Uint8Array => {
  if (typeof content === 'string') return new TextEncoder().encode(content);
  return content instanceof Uint8Array ? content : new Uint8Array(content);
};

const toAttachment = (attachment: Attachment, index: number): ExtractedAttachment => ({
  filename:
    attachment.filename === null || attachment.filename === ''
      ? `attachment-${String(index + 1)}`
      : attachment.filename,
  mime: attachment.mimeType,
  bytes: toBytes(attachment.content),
  inline: attachment.related === true || attachment.disposition === 'inline',
});

const bodyOf = ({ text, html }: Email): string => {
  if (text !== undefined && text.trim() !== '') return text;
  return html === undefined ? '' : htmlToText(html);
};

// A header field name is printable ASCII without a colon, directly followed by a colon
// (RFC 5322, 2.2). The parser itself accepts any bytes and returns them as a body, so
// without this a PDF or an image declared as an email would become a page of noise.
const HEADER_FIELD = /^[\x21-\x39\x3b-\x7e]+:/;
const SNIFFED_BYTES = 256;

const assertStartsWithHeaderField = (bytes: Uint8Array): void => {
  const start = Buffer.from(bytes.subarray(0, SNIFFED_BYTES)).toString('latin1');
  if (!HEADER_FIELD.test(start)) {
    throw new TextExtractionError(
      'eml_corrupt',
      'The file is not an email: it does not start with a header field',
    );
  }
};

export const extractEml = async (bytes: Uint8Array): Promise<ExtractedText> => {
  assertStartsWithHeaderField(bytes);
  const { default: PostalMime } = await loadParser();
  const email = await PostalMime.parse(bytes, { attachmentEncoding: 'arraybuffer' }).catch(
    (error: unknown) => {
      throw new TextExtractionError('eml_corrupt', 'The email could not be parsed', {
        cause: error,
      });
    },
  );
  const text = [headerBlock(email), bodyOf(email)].filter((part) => part !== '').join('\n\n');
  return {
    pages: [{ page: 1, text: normalizeText(text) }],
    method: 'native',
    attachments: email.attachments.map(toAttachment),
  };
};
