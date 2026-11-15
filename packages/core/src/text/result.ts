import type { TextExtractionMethod } from '@liasse/contract/domain';
import type { ExtractedAttachment, ExtractedPage, ExtractedText } from './types.ts';

export interface PageText {
  readonly text: string;
  // The model that transcribed the page; absent when the text is the file's own.
  readonly visionModel?: string;
}

const overallMethod = (pages: readonly ExtractedPage[]): TextExtractionMethod => {
  const methods = new Set(pages.map(({ method }) => method));
  const [only] = methods;
  return methods.size === 1 && only !== undefined ? only : 'mixed';
};

// Numbers the pages from 1 and derives the method of the document from its pages.
export const toExtractedText = (
  pageTexts: readonly PageText[],
  attachments: readonly ExtractedAttachment[] = [],
): ExtractedText => {
  const pages = pageTexts.map(({ text, visionModel }, index): ExtractedPage => ({
    page: index + 1,
    text,
    method: visionModel === undefined ? 'native' : 'vision',
  }));
  const visionModel = pageTexts.find((page) => page.visionModel !== undefined)?.visionModel;
  return {
    pages,
    method: overallMethod(pages),
    ...(visionModel === undefined ? {} : { visionModel }),
    attachments,
  };
};
