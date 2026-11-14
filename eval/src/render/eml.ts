import type { Mailbox } from '../scenario/model.ts';

export interface EmlAttachment {
  readonly filename: string;
  readonly mime: string;
  readonly bytes: Uint8Array;
}

export interface EmlMessage {
  readonly id: string;
  readonly from: Mailbox;
  readonly to: Mailbox;
  readonly date: string;
  readonly subject: string;
  readonly lines: readonly string[];
  readonly attachments: readonly EmlAttachment[];
}

const BASE64_LINE_LENGTH = 76;

const isAscii = (text: string): boolean => /^[\x20-\x7e]*$/.test(text);

// RFC 2047: a header carries anything beyond ASCII as an encoded word.
const headerText = (text: string): string =>
  isAscii(text) ? text : `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`;

const mailbox = ({ name, address }: Mailbox): string => `${headerText(name)} <${address}>`;

const base64Lines = (bytes: Uint8Array): readonly string[] =>
  Buffer.from(bytes)
    .toString('base64')
    .match(new RegExp(`.{1,${String(BASE64_LINE_LENGTH)}}`, 'g')) ?? [];

const attachmentPart = (boundary: string, attachment: EmlAttachment): readonly string[] => [
  `--${boundary}`,
  `Content-Type: ${attachment.mime}; name="${attachment.filename}"`,
  `Content-Disposition: attachment; filename="${attachment.filename}"`,
  'Content-Transfer-Encoding: base64',
  '',
  ...base64Lines(attachment.bytes),
];

// A message as a mail client saves it: headers, a plain text body in UTF-8 and the
// attachments in base64, with the line endings of the protocol.
export const buildEml = (message: EmlMessage): Uint8Array => {
  const boundary = `liasse-eval-${message.id}`;
  const domain = message.from.address.slice(message.from.address.indexOf('@') + 1);
  return new TextEncoder().encode(
    [
      `From: ${mailbox(message.from)}`,
      `To: ${mailbox(message.to)}`,
      `Subject: ${headerText(message.subject)}`,
      `Date: ${message.date}`,
      `Message-ID: <${message.id}@${domain}>`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      ...message.lines,
      ...message.attachments.flatMap((attachment) => attachmentPart(boundary, attachment)),
      `--${boundary}--`,
      '',
    ].join('\r\n'),
  );
};
