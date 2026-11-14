import { decodeCharacterReferences } from '../character-references.ts';
import { TextExtractionError } from '../errors.ts';

export interface XmlElement {
  readonly name: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: readonly XmlNode[];
}

export type XmlNode = XmlElement | string;

interface OpenElement {
  readonly name: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: XmlNode[];
}

// Deeper than any real document, and far below what would exhaust the stack of the
// recursive functions that walk the tree afterwards.
export const MAX_XML_DEPTH = 256;

const XML_ENTITIES: ReadonlyMap<string, string> = new Map([
  ['lt', '<'],
  ['gt', '>'],
  ['amp', '&'],
  ['quot', '"'],
  ['apos', "'"],
]);

const malformed = (reason: string): TextExtractionError =>
  new TextExtractionError('docx_corrupt', `The document XML is not well formed: ${reason}`);

const decodeEntities = (text: string): string => decodeCharacterReferences(text, XML_ENTITIES);

const parseAttributes = (source: string): Readonly<Record<string, string>> =>
  Object.fromEntries(
    Array.from(source.matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g), (match) => [
      match[1] ?? '',
      decodeEntities(match[2] ?? match[3] ?? ''),
    ]),
  );

const MARKUP_ENDS = [
  ['<!--', '-->'],
  ['<![CDATA[', ']]>'],
  ['<?', '?>'],
  ['<!', '>'],
  ['<', '>'],
] as const;

interface Markup {
  readonly opening: string;
  readonly body: string;
  readonly end: number;
}

const readMarkup = (xml: string, start: number): Markup => {
  const [opening, closing] = MARKUP_ENDS.find(([prefix]) => xml.startsWith(prefix, start)) ?? [
    '<',
    '>',
  ];
  const bodyEnd = xml.indexOf(closing, start + opening.length);
  if (bodyEnd === -1) throw malformed('unterminated markup');
  return {
    opening,
    body: xml.slice(start + opening.length, bodyEnd),
    end: bodyEnd + closing.length,
  };
};

const openElement = (body: string): OpenElement => {
  const source = body.endsWith('/') ? body.slice(0, -1) : body;
  const nameEnd = source.search(/\s/);
  return {
    name: nameEnd === -1 ? source : source.slice(0, nameEnd),
    attributes: nameEnd === -1 ? {} : parseAttributes(source.slice(nameEnd)),
    children: [],
  };
};

// A small, non-validating parser for the XML that Word writes: elements, attributes,
// text, CDATA and the five predefined entities. Declarations, comments and processing
// instructions are skipped; DTD entities are never expanded.
export const parseXml = (xml: string): XmlElement => {
  const root: OpenElement = { name: '#document', attributes: {}, children: [] };
  const stack: OpenElement[] = [root];
  let position = 0;
  while (position < xml.length) {
    const current = stack.at(-1) ?? root;
    const start = xml.indexOf('<', position);
    const text = xml.slice(position, start === -1 ? xml.length : start);
    if (text !== '') current.children.push(decodeEntities(text));
    if (start === -1) break;
    const { opening, body, end } = readMarkup(xml, start);
    position = end;
    if (opening === '<![CDATA[') {
      current.children.push(body);
    } else if (opening === '<' && body.startsWith('/')) {
      if (stack.length === 1 || current.name !== body.slice(1).trim()) {
        throw malformed('unbalanced closing tag');
      }
      stack.pop();
    } else if (opening === '<') {
      const element = openElement(body);
      current.children.push(element);
      if (!body.endsWith('/')) {
        if (stack.length >= MAX_XML_DEPTH) throw malformed('elements nested too deeply');
        stack.push(element);
      }
    }
  }
  if (stack.length !== 1) throw malformed('unclosed element');
  return root;
};
