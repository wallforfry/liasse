import type { XmlElement, XmlNode } from './xml.ts';

// WordprocessingML names are matched without their namespace prefix: `w:` is a convention
// of Word, not a requirement of the format.
const localName = ({ name }: XmlElement): string => name.slice(name.indexOf(':') + 1);

const elementsOf = (node: XmlElement): readonly XmlElement[] =>
  node.children.filter((child): child is XmlElement => typeof child !== 'string');

const childNamed = (node: XmlElement, name: string): XmlElement | undefined =>
  elementsOf(node).find((child) => localName(child) === name);

const attribute = (node: XmlElement | undefined, name: string): string | undefined =>
  Object.entries(node?.attributes ?? {}).find(
    ([key]) => key.slice(key.indexOf(':') + 1) === name,
  )?.[1];

const textOf = (nodes: readonly XmlNode[]): string =>
  nodes.filter((child) => typeof child === 'string').join('');

// `mc:AlternateContent` carries the same content twice, for new and old readers; deleted
// text (`w:delText`) and field codes (`w:instrText`) are not `w:t` and so never appear.
const inlineText = (node: XmlElement): string => {
  switch (localName(node)) {
    case 't':
      return textOf(node.children);
    case 'tab':
      return ' ';
    case 'br':
    case 'cr':
      return '\n';
    case 'noBreakHyphen':
      return '-';
    case 'pPr':
    case 'rPr':
    case 'Fallback':
      return '';
    case 'p':
      return `${elementsOf(node).map(inlineText).join('')}\n`;
    default:
      return elementsOf(node).map(inlineText).join('');
  }
};

const paragraphPrefix = (paragraph: XmlElement): string => {
  const properties = childNamed(paragraph, 'pPr');
  if (properties === undefined) return '';
  const style = attribute(childNamed(properties, 'pStyle'), 'val') ?? '';
  const heading = /^heading\s?([1-6])$/i.exec(style)?.[1];
  if (heading !== undefined) return `${'#'.repeat(Number(heading))} `;
  if (/^title$/i.test(style)) return '# ';
  return childNamed(properties, 'numPr') === undefined ? '' : '- ';
};

const renderParagraph = (paragraph: XmlElement): string => {
  const text = elementsOf(paragraph).map(inlineText).join('').trim();
  return text === '' ? '' : `${paragraphPrefix(paragraph)}${text}`;
};

const renderCell = (cell: XmlElement): string =>
  renderBlocks(cell).join(' ').replace(/\s+/g, ' ').replaceAll('|', '\\|');

const renderTable = (table: XmlElement): string => {
  const rows = elementsOf(table)
    .filter((child) => localName(child) === 'tr')
    .map((row) =>
      elementsOf(row)
        .filter((child) => localName(child) === 'tc')
        .map(renderCell),
    )
    .filter((cells) => cells.length > 0);
  const [header, ...body] = rows;
  if (header === undefined) return '';
  const line = (cells: readonly string[]): string => `| ${cells.join(' | ')} |`;
  return [line(header), line(header.map(() => '---')), ...body.map(line)].join('\n');
};

const renderBlocks = (container: XmlElement): readonly string[] =>
  elementsOf(container)
    .flatMap((child) => {
      switch (localName(child)) {
        case 'p':
          return [renderParagraph(child)];
        case 'tbl':
          return [renderTable(child)];
        case 'sectPr':
        case 'tcPr':
        case 'Fallback':
          return [];
        default:
          return renderBlocks(child);
      }
    })
    .filter((block) => block !== '');

const findElement = (node: XmlElement, name: string): XmlElement | undefined =>
  localName(node) === name
    ? node
    : elementsOf(node)
        .map((child) => findElement(child, name))
        .find((found) => found !== undefined);

// Renders the main story of `word/document.xml`. Headers, footers, footnotes and comments
// live in other parts of the package and are left out.
export const renderDocxMarkdown = (document: XmlElement): string | undefined => {
  const body = findElement(document, 'body');
  return body === undefined ? undefined : renderBlocks(body).join('\n\n');
};
