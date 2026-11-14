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
      { page: 1, text: `${HEADER_BLOCK}\n\nHello,\n\nPlease find the invoice attached.` },
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

  it('returns the body alone when the message has no known header', async () => {
    expect((await extract(eml(['X-Synthetic: 1', '', 'Only a body.']))).pages).toEqual([
      { page: 1, text: 'Only a body.' },
    ]);
  });

  it('returns the header block alone when the message has no body', async () => {
    expect((await extract(eml(['Subject: Reminder']))).pages[0]?.text).toBe('Subject: Reminder');
  });

  it.each([
    ['an empty file', new Uint8Array(0)],
    ['a PDF', buildSyntheticPdf([{ lines: ['Invoice 2026-001'] }])],
    ['a PNG', buildSyntheticPng(8, 8)],
    ['binary noise', Uint8Array.from({ length: 512 }, (_, index) => (index * 37 + 11) % 256)],
    ['text without any header', eml(['Dear Jane Doe,', '', 'No header above.'])],
    ['a header name with a space', eml(['Not a header: value', '', 'Body.'])],
  ])('reports %s as not being an email', async (_, bytes) => {
    const failure = extract(bytes);
    await expect(failure).rejects.toMatchObject({
      name: 'TextExtractionError',
      code: 'eml_corrupt',
    });
    await expect(failure).rejects.toThrow(/does not start with a header field/);
  });

  it('reports a message nested beyond what the parser accepts', async () => {
    const depth = 300;
    const nested = eml([
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
    });
  });
});
