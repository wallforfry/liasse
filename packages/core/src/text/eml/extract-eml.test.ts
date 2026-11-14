import { describe, expect, it } from 'vitest';
import { createFakeVisionModel } from '../../testing/fake-vision-model.ts';
import { buildSyntheticPdf } from '../../testing/synthetic-pdf.ts';
import { buildSyntheticPng } from '../../testing/synthetic-png.ts';
import { extractText } from '../extract-text.ts';

const EML = 'message/rfc822';

const eml = (lines: readonly string[]): Uint8Array => new TextEncoder().encode(lines.join('\r\n'));

const base64Lines = (bytes: Uint8Array): readonly string[] =>
  Buffer.from(bytes)
    .toString('base64')
    .match(/.{1,76}/g) ?? [];

const HEADERS = [
  'From: Jane Doe <jane.doe@example.com>',
  'To: Billing <billing@example.org>, john.roe@example.org',
  'Cc: Example Archive <archive@example.org>',
  'Date: Tue, 03 Nov 2026 09:30:00 +0100',
  'Subject: Invoice 2026-001',
  'MIME-Version: 1.0',
];

const HEADER_BLOCK = [
  'From: Jane Doe <jane.doe@example.com>',
  'To: Billing <billing@example.org>, john.roe@example.org',
  'Cc: Example Archive <archive@example.org>',
  'Date: 2026-11-03T08:30:00.000Z',
  'Subject: Invoice 2026-001',
].join('\n');

const extract = async (bytes: Uint8Array) => {
  const vision = createFakeVisionModel();
  const result = await extractText({ bytes, mime: EML }, { vision });
  expect(vision.calls).toHaveLength(0);
  return result;
};

describe('extractText on an email', () => {
  const pdf = buildSyntheticPdf([{ lines: ['Invoice 2026-001 for Jane Doe', 'x'.repeat(100)] }]);
  const withAttachment = eml([
    ...HEADERS,
    'Content-Type: multipart/mixed; boundary="synthetic-boundary"',
    '',
    '--synthetic-boundary',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Hello,',
    '',
    'Please find the invoice attached.',
    '--synthetic-boundary',
    'Content-Type: application/pdf; name="invoice.pdf"',
    'Content-Disposition: attachment; filename="invoice.pdf"',
    'Content-Transfer-Encoding: base64',
    '',
    ...base64Lines(pdf),
    '--synthetic-boundary--',
    '',
  ]);

  it('renders the headers and the body as one native page', async () => {
    const result = await extract(withAttachment);
    expect(result.method).toBe('native');
    expect(result.pages).toEqual([
      {
        page: 1,
        text: `${HEADER_BLOCK}\n\nHello,\n\nPlease find the invoice attached.`,
        method: 'native',
      },
    ]);
  });

  it('returns a PDF attachment as bytes that extract on their own', async () => {
    const { attachments } = await extract(withAttachment);
    expect(attachments).toEqual([
      { filename: 'invoice.pdf', mime: 'application/pdf', bytes: pdf, inline: false },
    ]);
    const attached = await extractText(
      { bytes: attachments[0]?.bytes ?? new Uint8Array(0), mime: 'application/pdf' },
      { vision: createFakeVisionModel() },
    );
    expect(attached.pages[0]?.text).toContain('Invoice 2026-001 for Jane Doe');
  });

  it('prefers the plain text part over the HTML part', async () => {
    const result = await extract(
      eml([
        ...HEADERS,
        'Content-Type: multipart/alternative; boundary="synthetic-boundary"',
        '',
        '--synthetic-boundary',
        'Content-Type: text/plain; charset=utf-8',
        '',
        'Plain body.',
        '--synthetic-boundary',
        'Content-Type: text/html; charset=utf-8',
        '',
        '<p>HTML body.</p>',
        '--synthetic-boundary--',
        '',
      ]),
    );
    expect(result.pages[0]?.text).toBe(`${HEADER_BLOCK}\n\nPlain body.`);
  });

  it('falls back to the HTML part as text, without scripts, styles or markup', async () => {
    const result = await extract(
      eml([
        ...HEADERS,
        'Content-Type: text/html; charset=utf-8',
        '',
        '<html><head><style>p { color: red; }</style></head><body>',
        '<script>document.title = "executed";</script>',
        '<p>Your contract <b>renews</b> on 1 March.</p>',
        '<img src="https://tracker.example.com/pixel.png">',
        '<p>See <a href="https://example.com/contract">the contract</a>.</p>',
        '</body></html>',
      ]),
    );
    expect(result.pages[0]?.text).toBe(
      [
        HEADER_BLOCK,
        'Your contract renews on 1 March.',
        'See the contract (https://example.com/contract).',
      ].join('\n\n'),
    );
  });

  it('flags an image displayed in the body as inline', async () => {
    const png = buildSyntheticPng(8, 8);
    const { attachments } = await extract(
      eml([
        ...HEADERS,
        'Content-Type: multipart/related; boundary="synthetic-boundary"',
        '',
        '--synthetic-boundary',
        'Content-Type: text/html; charset=utf-8',
        '',
        '<p>Logo: <img src="cid:logo@example.com"></p>',
        '--synthetic-boundary',
        'Content-Type: image/png',
        'Content-ID: <logo@example.com>',
        'Content-Disposition: inline',
        'Content-Transfer-Encoding: base64',
        '',
        ...base64Lines(png),
        '--synthetic-boundary--',
        '',
      ]),
    );
    expect(attachments).toEqual([
      { filename: 'attachment-1', mime: 'image/png', bytes: png, inline: true },
    ]);
  });

  // The parser replaces the line breaks of a decoded header; this pins that behaviour, on
  // which the header block relies to keep one header per line.
  it('keeps a header value on one line', async () => {
    const result = await extract(
      eml([
        'From: jane.doe@example.com',
        'Subject: =?utf-8?Q?Hello=0AFrom:_forged@example.com?=',
        '',
        'Body.',
      ]),
    );
    expect(result.pages[0]?.text).toBe(
      'From: jane.doe@example.com\nSubject: Hello From: forged@example.com\n\nBody.',
    );
  });

  it('returns the body alone when no header of the block is rendered', async () => {
    const message = eml([
      'Return-Path: <jane.doe@example.com>',
      'MIME-Version: 1.0',
      '',
      'Only a body.',
    ]);
    expect((await extract(message)).pages).toEqual([
      { page: 1, text: 'Only a body.', method: 'native' },
    ]);
  });

  it('returns the header block alone when the message has no body', async () => {
    const message = eml(['From: jane.doe@example.com', 'Subject: Reminder']);
    expect((await extract(message)).pages[0]?.text).toBe(
      'From: jane.doe@example.com\nSubject: Reminder',
    );
  });

  it.each([
    ['an empty file', new Uint8Array(0), /does not start with a header field/],
    [
      'a PDF',
      buildSyntheticPdf([{ lines: ['Invoice 2026-001'] }]),
      /does not start with a header field/,
    ],
    ['a PNG', buildSyntheticPng(8, 8), /does not start with a header field/],
    [
      'binary noise',
      Uint8Array.from({ length: 512 }, (_, index) => (index * 37 + 11) % 256),
      /does not start with a header field/,
    ],
    [
      'text without any header',
      eml(['Dear Jane Doe,', '', 'No header above.']),
      /does not start with a header field/,
    ],
    [
      'a header name with a space',
      eml(['Not a header: value', 'Subject: Hi', '', 'Body.']),
      /does not start with a header field/,
    ],
    [
      'a space before the first colon',
      eml(['subject : Hi', '', 'Body.']),
      /does not start with a header field/,
    ],
    ['a JSON document', eml(['{"a":1}']), /it names no sender/],
    [
      'a note that starts like a header',
      eml(['Note: call Jane Doe', '', 'Tomorrow.']),
      /it names no sender/,
    ],
    [
      'a known header only in the body',
      eml(['Note: x', '', 'Subject: not a header']),
      /it names no sender/,
    ],
    [
      'a message that names no sender',
      eml(['Subject: Hi', 'MIME-Version: 1.0', '', 'Body.']),
      /it names no sender/,
    ],
    [
      'a message after a byte order mark',
      Uint8Array.from([0xef, 0xbb, 0xbf, ...eml(['From: a@example.com', 'Subject: Hi', '', 'B'])]),
      /does not start with a header field/,
    ],
    [
      'a message after blank lines',
      eml(['', '', 'From: a@example.com', 'Subject: Hi', '', 'Body.']),
      /does not start with a header field/,
    ],
  ])('reports %s as not being an email', async (_, bytes, message) => {
    const failure = extract(bytes);
    await expect(failure).rejects.toMatchObject({
      name: 'TextExtractionError',
      code: 'eml_corrupt',
      retryable: false,
    });
    await expect(failure).rejects.toThrow(message);
  });

  it('reports a message nested beyond what the parser accepts', async () => {
    const depth = 300;
    const nested = eml([
      'From: jane.doe@example.com',
      'Date: Tue, 03 Nov 2026 09:30:00 +0100',
      ...Array.from({ length: depth }, (_, level) => [
        `Content-Type: multipart/mixed; boundary="b${String(level)}"`,
        '',
        `--b${String(level)}`,
      ]).flat(),
      'Content-Type: text/plain',
      '',
      'Deep.',
    ]);
    await expect(extract(nested)).rejects.toMatchObject({
      name: 'TextExtractionError',
      code: 'eml_corrupt',
      message: 'The email could not be parsed',
    });
  });
});
