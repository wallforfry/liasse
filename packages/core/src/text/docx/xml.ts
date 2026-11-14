import { decodeCharacterReferences } from '../character-references.ts';
import { TextExtractionError } from '../errors.ts';
import { findTagEnd } from '../markup.ts';

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

const NO_ATTRIBUTES: Readonly<Record<string, string>> = Object.freeze({});

// Told how many characters each step of the scan reads. Only tests pass one: the sum is
// the work of the scan, which a clock cannot measure on a loaded machine. The work a
// regular expression does inside one search cannot be counted, which is why the scan is
// made of steps that each read a known number of characters instead of one pattern.
export type ScanProbe = (examined: number) => void;

// Sticky and without alternative: each matches one run where it is asked to, in one pass.
// Parsing is synchronous, so sharing the `lastIndex` of a pattern is safe.
const SPACES = /\s*/y;
const NAME = /[^\s=]*/y;

const runLength = (run: RegExp, source: string, from: number, probe?: ScanProbe): number => {
  run.lastIndex = from;
  const length = run.exec(source)?.[0].length ?? 0;
  probe?.(length + 1);
  return length;
};

interface Attribute {
  readonly name: string;
  readonly value: string;
  readonly end: number;
}

// The attribute that starts at `from`: `name = "value"` or `name = 'value'`, spaces
// optional. `undefined` for anything else.
const readAttribute = (source: string, from: number, probe?: ScanProbe): Attribute | undefined => {
  const nameStart = from + runLength(SPACES, source, from, probe);
  const nameEnd = nameStart + runLength(NAME, source, nameStart, probe);
  const equals = nameEnd + runLength(SPACES, source, nameEnd, probe);
  if (nameEnd === nameStart || source[equals] !== '=') return undefined;
  const opening = equals + 1 + runLength(SPACES, source, equals + 1, probe);
  const quote = source[opening];
  if (quote !== '"' && quote !== "'") return undefined;
  const closing = source.indexOf(quote, opening + 1);
  probe?.((closing === -1 ? source.length : closing) - opening);
  if (closing === -1) return undefined;
  return {
    name: source.slice(nameStart, nameEnd),
    value: source.slice(opening + 1, closing),
    end: closing + 1,
  };
};

// Each attribute is read where the previous one ended and the scan stops at the first
// thing that is not one. Looking for the next attribute further on would retry from every
// offset of a long run without `=`, which is quadratic.
export const parseAttributes = (
  source: string,
  probe?: ScanProbe,
): Readonly<Record<string, string>> => {
  const attributes: [string, string][] = [];
  for (
    let attribute = readAttribute(source, 0, probe);
    attribute !== undefined;
    attribute = readAttribute(source, attribute.end, probe)
  ) {
    attributes.push([attribute.name, decodeEntities(attribute.value)]);
  }
  return attributes.length === 0 ? NO_ATTRIBUTES : Object.fromEntries(attributes);
};

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
  const bodyStart = start + opening.length;
  const bodyEnd = opening === '<' ? findTagEnd(xml, bodyStart) : xml.indexOf(closing, bodyStart);
  if (bodyEnd === -1) throw malformed('unterminated markup');
  return {
    opening,
    body: xml.slice(bodyStart, bodyEnd),
    end: bodyEnd + closing.length,
  };
};

const openElement = (body: string): OpenElement => {
  const source = body.endsWith('/') ? body.slice(0, -1) : body;
  const nameEnd = source.search(/\s/);
  return {
    name: nameEnd === -1 ? source : source.slice(0, nameEnd),
    attributes: nameEnd === -1 ? NO_ATTRIBUTES : parseAttributes(source.slice(nameEnd)),
    children: [],
  };
};

export interface XmlLimits {
  readonly maxNodes: number;
  // Counted as written, before entities are decoded: decoding and rendering a text copy
  // it several times, so the cap has to hold before the first copy.
  readonly maxTextChars: number;
}

const tooLarge = (limit: number, unit: string): TextExtractionError =>
  new TextExtractionError(
    'docx_too_large',
    `The document XML holds more than the limit of ${String(limit)} ${unit}`,
  );

const createBudget = ({ maxNodes, maxTextChars }: XmlLimits) => {
  let nodes = 0;
  let textChars = 0;
  return {
    countNode: (): void => {
      nodes += 1;
      if (nodes > maxNodes) throw tooLarge(maxNodes, 'nodes');
    },
    countText: (length: number): void => {
      textChars += length;
      if (textChars > maxTextChars) throw tooLarge(maxTextChars, 'characters of text');
    },
  };
};

// A small, non-validating parser for the XML that Word writes: elements, attributes,
// text, CDATA and the five predefined entities. Declarations, comments and processing
// instructions are skipped; DTD entities are never expanded. The size of the XML bounds
// its bytes, not the memory of what is built from it, so the tree holds at most
// `maxNodes` elements and text nodes and `maxTextChars` characters of text.
export const parseXml = (xml: string, limits: XmlLimits): XmlElement => {
  const root: OpenElement = { name: '#document', attributes: NO_ATTRIBUTES, children: [] };
  const stack: OpenElement[] = [root];
  const budget = createBudget(limits);
  const append = (parent: OpenElement, node: XmlNode): void => {
    budget.countNode();
    parent.children.push(node);
  };
  let position = 0;
  while (position < xml.length) {
    const current = stack.at(-1) ?? root;
    const start = xml.indexOf('<', position);
    const text = xml.slice(position, start === -1 ? xml.length : start);
    if (text !== '') {
      budget.countText(text.length);
      append(current, decodeEntities(text));
    }
    if (start === -1) break;
    const { opening, body, end } = readMarkup(xml, start);
    position = end;
    if (opening === '<![CDATA[') {
      budget.countText(body.length);
      append(current, body);
    } else if (opening === '<' && body.startsWith('/')) {
      if (stack.length === 1 || current.name !== body.slice(1).trim()) {
        throw malformed('unbalanced closing tag');
      }
      stack.pop();
    } else if (opening === '<') {
      const element = openElement(body);
      append(current, element);
      if (!body.endsWith('/')) {
        if (stack.length >= MAX_XML_DEPTH) throw malformed('elements nested too deeply');
        stack.push(element);
      }
    }
  }
  if (stack.length !== 1) throw malformed('unclosed element');
  return root;
};
