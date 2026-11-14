import { describe, expect, it } from 'vitest';
import { createFakeVisionModel } from '../../testing/fake-vision-model.ts';
import { buildSyntheticDocx, syntheticDocumentXml } from '../../testing/synthetic-docx.ts';
import { buildSyntheticZip } from '../../testing/synthetic-zip.ts';
import { extractText } from '../extract-text.ts';
import { DEFAULT_TEXT_LIMITS } from '../limits.ts';
import { MAX_XML_DEPTH } from './xml.ts';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const paragraph = (text: string, properties = ''): string =>
  `<w:p>${properties === '' ? '' : `<w:pPr>${properties}</w:pPr>`}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

const cell = (text: string): string => `<w:tc><w:tcPr/>${paragraph(text)}</w:tc>`;

const extract = async (bytes: Uint8Array, maxDocxXmlBytes?: number) => {
  const vision = createFakeVisionModel();
  const result = await extractText(
    { bytes, mime: DOCX },
    { vision, ...(maxDocxXmlBytes === undefined ? {} : { limits: { maxDocxXmlBytes } }) },
  );
  expect(vision.calls).toHaveLength(0);
  return result;
};

const textOf = async (bodyXml: string): Promise<string | undefined> =>
  (await extract(buildSyntheticDocx(bodyXml))).pages[0]?.text;

const xmlEntry = (xml: string) => ({
  name: 'word/document.xml',
  data: new TextEncoder().encode(xml),
});

describe('extractText on a DOCX', () => {
  it('returns the document as one native page', async () => {
    const bytes = buildSyntheticDocx(
      [paragraph('Employment contract'), paragraph('Between Jane Doe and Example Corp.')].join(''),
    );
    expect(await extract(bytes)).toEqual({
      pages: [
        {
          page: 1,
          text: 'Employment contract\n\nBetween Jane Doe and Example Corp.',
          method: 'native',
        },
      ],
      method: 'native',
      attachments: [],
    });
  });

  it('renders headings, a title and list items', async () => {
    const body = [
      paragraph('Lease', '<w:pStyle w:val="Title"/>'),
      paragraph('Parties', '<w:pStyle w:val="Heading2"/>'),
      paragraph('Jane Doe', '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>'),
      paragraph('Example Corp', '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>'),
    ].join('');
    expect(await textOf(body)).toBe('# Lease\n\n## Parties\n\n- Jane Doe\n\n- Example Corp');
  });

  it('renders a table as a Markdown table and escapes pipes', async () => {
    const body = [
      '<w:tbl><w:tblPr/>',
      `<w:tr>${cell('Item')}${cell('Amount')}</w:tr>`,
      `<w:tr>${cell('Rent | March')}${cell('850.00 EUR')}</w:tr>`,
      '</w:tbl>',
    ].join('');
    expect(await textOf(body)).toBe(
      '| Item | Amount |\n| --- | --- |\n| Rent \\| March | 850.00 EUR |',
    );
  });

  it('joins the runs of a paragraph and honours tabs and line breaks', async () => {
    const body =
      '<w:p><w:r><w:t>Total</w:t><w:tab/><w:t>84.20</w:t></w:r><w:r><w:br/><w:t>Due on receipt</w:t></w:r></w:p>';
    expect(await textOf(body)).toBe('Total 84.20\nDue on receipt');
  });

  it('decodes entities and CDATA', async () => {
    const body = paragraph('Doe &amp; Co &lt;billing&gt; &#233;t&#xE9; <![CDATA[<raw & kept>]]>');
    expect(await textOf(body)).toBe('Doe & Co <billing> été <raw & kept>');
  });

  it('leaves out deleted text, field codes and the fallback of alternate content', async () => {
    const body = [
      '<w:p>',
      '<w:del><w:r><w:delText>Removed clause</w:delText></w:r></w:del>',
      '<w:r><w:instrText>PAGE</w:instrText></w:r>',
      '<w:r><mc:AlternateContent>',
      '<mc:Choice Requires="wps"><w:t>Kept once</w:t></mc:Choice>',
      '<mc:Fallback><w:t>Kept once</w:t></mc:Fallback>',
      '</mc:AlternateContent></w:r>',
      '</w:p>',
    ].join('');
    expect(await textOf(body)).toBe('Kept once');
  });

  it('skips empty paragraphs', async () => {
    expect(await textOf(`${paragraph('One')}<w:p/><w:p><w:r/></w:p>${paragraph('Two')}`)).toBe(
      'One\n\nTwo',
    );
  });
});

// `w:document`, `w:body` and the `w:p`, `w:r`, `w:t` of the paragraph take five of the
// 255 levels an element may sit at.
const DEEPEST_WRAPPERS = MAX_XML_DEPTH - 1 - 5;

const nestedParagraph = (wrappers: number): string =>
  `${'<w:x>'.repeat(wrappers)}${paragraph('Deep')}${'</w:x>'.repeat(wrappers)}`;

describe('extractText on a DOCX it cannot read', () => {
  it.each([
    [
      'bytes that are not an archive',
      new TextEncoder().encode('Dear Jane Doe, no archive here.'),
      /no end of central directory/,
    ],
    ['an empty file', new Uint8Array(0), /no end of central directory/],
    [
      'an archive missing its beginning',
      buildSyntheticDocx(paragraph('Jane Doe')).slice(40),
      /bad central directory entry/,
    ],
    [
      'an archive without a main document',
      buildSyntheticZip([{ ...xmlEntry(''), name: 'a.xml' }]),
      /holds no word\/document\.xml/,
    ],
    [
      'a main document without a body',
      buildSyntheticZip([xmlEntry('<w:document/>')]),
      /has no document body/,
    ],
    [
      'an unclosed element',
      buildSyntheticZip([xmlEntry('<w:document><w:body>')]),
      /unclosed element/,
    ],
    [
      'a mismatched closing tag',
      buildSyntheticZip([xmlEntry('<w:document><w:body></w:document></w:body>')]),
      /unbalanced closing tag/,
    ],
    [
      'a closing tag without an element',
      buildSyntheticZip([xmlEntry('<w:document><w:body/></w:document></w:document>')]),
      /unbalanced closing tag/,
    ],
    [
      'unterminated markup',
      buildSyntheticZip([xmlEntry('<w:document><w:body/></w:document')]),
      /unterminated markup/,
    ],
    [
      'elements nested too deeply',
      buildSyntheticDocx(nestedParagraph(DEEPEST_WRAPPERS + 1)),
      /nested too deeply/,
    ],
  ])('reports %s as corrupt', async (_, bytes, message) => {
    const failure = extract(bytes);
    await expect(failure).rejects.toMatchObject({
      name: 'TextExtractionError',
      code: 'docx_corrupt',
    });
    await expect(failure).rejects.toThrow(message);
  });

  it('reports an archive cut short as corrupt', async () => {
    const whole = buildSyntheticDocx(paragraph('Jane Doe'));
    const endRecord = whole.slice(-22);
    const failure = extract(Uint8Array.from([...whole.slice(0, 10), ...endRecord]));
    await expect(failure).rejects.toMatchObject({ code: 'docx_corrupt' });
    await expect(failure).rejects.toThrow(/truncated archive|bad central directory entry/);
  });

  it('accepts elements nested exactly as deep as the limit', async () => {
    const bytes = buildSyntheticDocx(nestedParagraph(DEEPEST_WRAPPERS));
    expect((await extract(bytes)).pages[0]?.text).toBe('Deep');
  });

  it('reports corrupt compressed data', async () => {
    const bytes = buildSyntheticDocx(paragraph('Jane Doe'));
    const start = Buffer.from(bytes).indexOf('word/document.xml') + 'word/document.xml'.length;
    const damaged = bytes.slice();
    damaged.fill(0xff, start, start + 8);
    const failure = extract(damaged);
    await expect(failure).rejects.toMatchObject({ code: 'docx_corrupt' });
    await expect(failure).rejects.toThrow(/invalid compressed data/);
  });

  // Rewrites one field of the central directory entry of a single-file archive.
  const withCentralField = (archive: Uint8Array, offset: number, value: number): Uint8Array => {
    const patched = archive.slice();
    const entry = Buffer.from(patched).lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    new DataView(patched.buffer).setUint16(entry + offset, value, true);
    return patched;
  };
  const single = buildSyntheticZip([xmlEntry(syntheticDocumentXml(paragraph('Jane Doe')))]);

  it('reports a compression method it cannot expand', async () => {
    const bzip2 = 12;
    const failure = extract(withCentralField(single, 10, bzip2));
    await expect(failure).rejects.toMatchObject({ code: 'docx_corrupt' });
    await expect(failure).rejects.toThrow(/unsupported compression method/);
  });

  it('reports an entry that points away from its file header', async () => {
    const failure = extract(withCentralField(single, 42, 5));
    await expect(failure).rejects.toMatchObject({ code: 'docx_corrupt' });
    await expect(failure).rejects.toThrow(/bad local file header/);
  });

  it('reports file data that runs past the end of the archive', async () => {
    const failure = extract(withCentralField(single, 20, 0xffff));
    await expect(failure).rejects.toMatchObject({ code: 'docx_corrupt' });
    await expect(failure).rejects.toThrow(/truncated file data/);
  });
});

describe('extractText on a DOCX with too many elements', () => {
  // `w:document`, `w:body`, `w:sectPr`, then `w:p`, `w:r`, `w:t` and its text per paragraph.
  const bytes = buildSyntheticDocx(paragraph('One') + paragraph('Two'));
  const nodes = 3 + 2 * 4;
  const extractWithin = (maxDocxXmlNodes: number) =>
    extractText(
      { bytes, mime: DOCX },
      { vision: createFakeVisionModel(), limits: { maxDocxXmlNodes } },
    );

  it('accepts a document with exactly as many nodes as the limit', async () => {
    expect((await extractWithin(nodes)).pages[0]?.text).toBe('One\n\nTwo');
  });

  it('refuses a document with one node more than the limit', async () => {
    await expect(extractWithin(nodes - 1)).rejects.toMatchObject({
      name: 'TextExtractionError',
      code: 'docx_too_large',
      retryable: false,
    });
  });

  it('holds at most 250 000 nodes by default', () => {
    expect(DEFAULT_TEXT_LIMITS.maxDocxXmlNodes).toBe(250_000);
  });
});

describe('extractText on a DOCX with too much text', () => {
  // Entities count as written: the cap is checked before they are decoded.
  const bytes = buildSyntheticDocx(paragraph('12345') + paragraph('&amp;<![CDATA[6789]]>'));
  const characters = 5 + 5 + 4;
  const extractWithin = (maxDocxTextChars: number) =>
    extractText(
      { bytes, mime: DOCX },
      { vision: createFakeVisionModel(), limits: { maxDocxTextChars } },
    );

  it('accepts a document with exactly as many characters of text as the limit', async () => {
    expect((await extractWithin(characters)).pages[0]?.text).toBe('12345\n\n&6789');
  });

  it('refuses a document with one character of text more than the limit', async () => {
    const failure = extractWithin(characters - 1);
    await expect(failure).rejects.toMatchObject({
      name: 'TextExtractionError',
      code: 'docx_too_large',
      retryable: false,
    });
    await expect(failure).rejects.toThrow(/characters of text/);
  });

  it('reads 8 MiB of XML and 2 000 000 characters of text by default', () => {
    expect(DEFAULT_TEXT_LIMITS.maxDocxXmlBytes).toBe(8 * 1024 * 1024);
    expect(DEFAULT_TEXT_LIMITS.maxDocxTextChars).toBe(2_000_000);
  });
});

describe('extractText on a DOCX that expands too much', () => {
  const body = paragraph('Jane Doe '.repeat(2000));
  const xml = syntheticDocumentXml(body);
  const expandedSize = new TextEncoder().encode(xml).length;

  it.each([
    ['compressed', false],
    ['stored', true],
  ])('accepts a %s main document exactly at the size limit', async (_, stored) => {
    const result = await extract(buildSyntheticZip([{ ...xmlEntry(xml), stored }]), expandedSize);
    expect(result.pages[0]?.text).toContain('Jane Doe Jane Doe');
  });

  it('stops inflating a main document at the size limit, whatever size it declares', async () => {
    const bomb = buildSyntheticZip([{ ...xmlEntry(xml), declaredSize: 10 }]);
    await expect(extract(bomb, expandedSize - 1)).rejects.toMatchObject({
      code: 'docx_too_large',
      cause: { code: 'ERR_BUFFER_TOO_LARGE' },
    });
  });

  it('refuses a stored main document larger than the size limit', async () => {
    const bomb = buildSyntheticZip([{ ...xmlEntry(xml), stored: true, declaredSize: 10 }]);
    await expect(extract(bomb, expandedSize - 1)).rejects.toMatchObject({
      code: 'docx_too_large',
    });
  });
});
