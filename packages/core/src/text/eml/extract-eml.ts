import type { Address, Attachment, Email } from 'postal-mime';
import { TextExtractionError } from '../errors.ts';
import { normalizeText } from '../normalize.ts';
import { toExtractedText } from '../result.ts';
import type { ExtractedAttachment, ExtractedText } from '../types.ts';
import { htmlToText } from './html-to-text.ts';
import { assertLooksLikeEmail } from './email-check.ts';

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

export const extractEml = async (bytes: Uint8Array): Promise<ExtractedText> => {
  assertLooksLikeEmail(bytes);
  const { default: PostalMime } = await loadParser();
  const email = await PostalMime.parse(bytes, { attachmentEncoding: 'arraybuffer' }).catch(
    (error: unknown) => {
      throw new TextExtractionError('eml_corrupt', 'The email could not be parsed', {
        cause: error,
      });
    },
  );
  const text = [headerBlock(email), bodyOf(email)].filter((part) => part !== '').join('\n\n');
  return toExtractedText([{ text: normalizeText(text) }], email.attachments.map(toAttachment));
};
