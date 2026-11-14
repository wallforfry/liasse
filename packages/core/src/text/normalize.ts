const normalizeLine = (line: string): string => line.replace(/(?<=\S)[^\S\n]+/g, ' ').trimEnd();

// Postgres rejects NUL bytes in `text`. Leading indentation survives because it carries
// structure in Markdown (nested lists, code blocks).
export const normalizeText = (text: string): string =>
  text
    .replaceAll('\u0000', '')
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(normalizeLine)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '')
    .trimEnd();
