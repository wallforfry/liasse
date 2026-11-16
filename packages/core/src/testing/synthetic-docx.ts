import { buildSyntheticZip } from './synthetic-zip.ts';

const CONTENT_TYPES = [
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
  '<Default Extension="xml" ContentType="application/xml"/>',
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
  '</Types>',
].join('');

const RELATIONSHIPS = [
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>',
  '</Relationships>',
].join('');

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

export const syntheticDocumentXml = (bodyXml: string): string =>
  [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"',
    ' xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">',
    `<w:body>${bodyXml}<w:sectPr/></w:body>`,
    '</w:document>',
  ].join('');

export interface SyntheticDocxOptions {
  // Stores the parts without compressing them. The bytes of a deflated part depend on the
  // zlib of the runtime; stored parts are the same everywhere, which a committed file needs.
  readonly stored?: boolean;
}

// A minimal package that Word opens: content types, the root relationship and the main
// document, whose body is the WordprocessingML given.
export const buildSyntheticDocx = (
  bodyXml: string,
  { stored = false }: SyntheticDocxOptions = {},
): Uint8Array<ArrayBuffer> =>
  buildSyntheticZip(
    [
      { name: '[Content_Types].xml', data: utf8(CONTENT_TYPES) },
      { name: '_rels/.rels', data: utf8(RELATIONSHIPS) },
      { name: 'word/document.xml', data: utf8(syntheticDocumentXml(bodyXml)) },
    ].map((entry) => ({ ...entry, stored })),
  );
