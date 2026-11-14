import { findTagEnd } from '../markup.ts';
import { decodeHtmlEntities } from './html-entities.ts';

// Elements whose content is never text of the message.
const SKIPPED_ELEMENTS = new Set(['script', 'style', 'head', 'title', 'template', 'noscript']);
const BLOCK_ELEMENTS = new Set([
  ...['p', 'div', 'br', 'hr', 'tr', 'table', 'ul', 'ol', 'li', 'blockquote', 'pre', 'section'],
  ...['article', 'header', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
]);
const CELL_ELEMENTS = new Set(['td', 'th']);
const LINK_SCHEMES = /^(?:https?:|mailto:)/i;

interface Tag {
  readonly name: string;
  readonly closing: boolean;
  readonly source: string;
  readonly end: number;
}

// `undefined` for a `<` that opens no tag, declaration or instruction: it is plain text.
const readTag = (html: string, start: number): Tag | undefined => {
  if (!/^<[a-z/!?]/i.test(html.slice(start, start + 2))) return undefined;
  const close = findTagEnd(html, start + 1);
  const source = html.slice(start + 1, close === -1 ? html.length : close);
  const match = /^(\/?)([a-z][a-z0-9]*)/i.exec(source);
  return {
    name: (match?.[2] ?? '').toLowerCase(),
    closing: match?.[1] === '/',
    source,
    end: close === -1 ? html.length : close + 1,
  };
};

// Where the content of a skipped element stops: after its closing tag, or at the end of
// the input when it is never closed.
const endOfSkipped = (html: string, name: string, from: number): number => {
  const closingTag = new RegExp(`</${name}\\b[^>]*>?`, 'gi');
  closingTag.lastIndex = from;
  return closingTag.exec(html) === null ? html.length : closingTag.lastIndex;
};

const linkTarget = ({ source }: Tag): string | undefined => {
  const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(source);
  const target = decodeHtmlEntities(href?.[1] ?? href?.[2] ?? href?.[3] ?? '').trim();
  return LINK_SCHEMES.test(target) ? target : undefined;
};

const separatorOf = (tag: Tag): string => {
  if (tag.name === 'li') return tag.closing ? '' : '\n- ';
  if (BLOCK_ELEMENTS.has(tag.name)) return '\n';
  return CELL_ELEMENTS.has(tag.name) && tag.closing ? ' ' : '';
};

const endOfComment = (html: string, start: number): number => {
  const end = html.indexOf('-->', start + 4);
  return end === -1 ? html.length : end + 3;
};

// Reads HTML as a string and never as a document: no script runs, no resource is fetched.
// A link keeps its address after its text. Every search moves forward from the current
// position, so hostile markup cannot make the conversion slow.
export const htmlToText = (html: string): string => {
  const parts: string[] = [];
  let pendingLink: string | undefined;
  let position = 0;
  while (position < html.length) {
    const start = html.indexOf('<', position);
    const text = html.slice(position, start === -1 ? html.length : start);
    parts.push(decodeHtmlEntities(text.replace(/\s+/g, ' ')));
    if (start === -1) break;
    const tag = html.startsWith('<!--', start) ? undefined : readTag(html, start);
    if (tag === undefined) {
      const comment = html.startsWith('<!--', start);
      if (!comment) parts.push('<');
      position = comment ? endOfComment(html, start) : start + 1;
    } else if (SKIPPED_ELEMENTS.has(tag.name) && !tag.closing) {
      position = endOfSkipped(html, tag.name, tag.end);
    } else {
      if (tag.name === 'a' && pendingLink !== undefined) parts.push(` (${pendingLink})`);
      if (tag.name === 'a') pendingLink = tag.closing ? undefined : linkTarget(tag);
      parts.push(separatorOf(tag));
      position = tag.end;
    }
  }
  return parts
    .join('')
    .split('\n')
    .map((line) => line.trim())
    .join('\n');
};
