export interface SyntheticAttachment {
  readonly filename: string;
  readonly mime: string;
  readonly bytes: Uint8Array;
  /** Displayed inside the message (`Content-Disposition: inline`), not attached. */
  readonly inline?: boolean;
}

export interface SyntheticEmailOptions {
  /** Makes the bytes, and so the hash, differ from one message to the next. */
  readonly label: string;
  readonly subject?: string;
  readonly from?: string;
  readonly attachments?: readonly SyntheticAttachment[];
}

const BOUNDARY = 'synthetic-boundary';
const LINE_LENGTH = 76;

const base64Lines = (bytes: Uint8Array): readonly string[] => {
  const text = Buffer.from(bytes).toString('base64');
  return Array.from({ length: Math.ceil(text.length / LINE_LENGTH) }, (_, index) =>
    text.slice(index * LINE_LENGTH, (index + 1) * LINE_LENGTH),
  );
};

const partOf = ({ filename, mime, bytes, inline = false }: SyntheticAttachment) => [
  `--${BOUNDARY}`,
  `Content-Type: ${mime}; name="${filename}"`,
  `Content-Disposition: ${inline ? 'inline' : 'attachment'}; filename="${filename}"`,
  'Content-Transfer-Encoding: base64',
  '',
  ...base64Lines(bytes),
];

/** A raw RFC 822 message: a text body and, when given, its parts. Synthetic content only. */
export const buildSyntheticEmail = ({
  label,
  subject = label,
  from = 'Sender <sender@example.com>',
  attachments = [],
}: SyntheticEmailOptions): Uint8Array<ArrayBuffer> => {
  const headers = [
    `From: ${from}`,
    'To: recipient@example.org',
    `Subject: ${subject}`,
    'Date: Mon, 02 Nov 2026 10:00:00 +0000',
    `Message-ID: <${label}@example.com>`,
    'MIME-Version: 1.0',
  ];
  const body = `Body of ${label}.`;
  const lines =
    attachments.length === 0
      ? [...headers, 'Content-Type: text/plain; charset=utf-8', '', body, '']
      : [
          ...headers,
          `Content-Type: multipart/mixed; boundary="${BOUNDARY}"`,
          '',
          `--${BOUNDARY}`,
          'Content-Type: text/plain; charset=utf-8',
          '',
          body,
          ...attachments.flatMap(partOf),
          `--${BOUNDARY}--`,
          '',
        ];
  return Uint8Array.from(Buffer.from(lines.join('\r\n'), 'utf8'));
};
