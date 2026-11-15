import {
  PAGE_TEXT_METHODS,
  supportedMimeSchema,
  TEXT_EXTRACTION_METHODS,
} from '@liasse/contract/domain';
import { z } from 'zod';
import { TEXT_EXTRACTION_ERROR_CODES } from '../../text/errors.ts';
import type { TextLimits } from '../../text/limits.ts';

// Messages between the server and the process that reads one document. Both ends parse
// what they receive: the child has read a file nobody vouches for.

// `z.instanceof` would narrow the buffer type further than the ports of the text
// extraction and of the vision model state it.
const bytes = z.custom<Uint8Array>((value) => value instanceof Uint8Array);

const textLimitsSchema = z.object({
  maxPdfPages: z.number(),
  maxVisionPages: z.number(),
  visionConcurrency: z.number(),
  renderTimeoutMs: z.number(),
  maxRenderEdgePx: z.number(),
  maxImageBytes: z.number(),
  maxHeicPixels: z.number(),
  maxHeicEdgePx: z.number(),
  maxDocxXmlBytes: z.number(),
  maxDocxXmlNodes: z.number(),
  maxDocxTextChars: z.number(),
}) satisfies z.ZodType<TextLimits>;

export const parentMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('extract'),
    bytes,
    mime: supportedMimeSchema,
    limits: textLimitsSchema,
    pdfRenderer: z.object({
      command: z.string().optional(),
      infoCommand: z.string().optional(),
      tempRoot: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal('vision_result'),
    id: z.number().int(),
    markdown: z.string(),
    model: z.string(),
  }),
]);
export type ParentMessage = z.output<typeof parentMessageSchema>;

const extractedTextSchema = z.object({
  pages: z
    .array(
      z.object({
        page: z.number().int().min(1),
        text: z.string(),
        method: z.enum(PAGE_TEXT_METHODS),
      }),
    )
    .readonly(),
  method: z.enum(TEXT_EXTRACTION_METHODS),
  visionModel: z.string().optional(),
  attachments: z
    .array(z.object({ filename: z.string(), mime: z.string(), bytes, inline: z.boolean() }))
    .readonly(),
});

export const childMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }),
  z.object({
    type: z.literal('vision'),
    id: z.number().int(),
    image: bytes,
    mime: z.string(),
    prompt: z.string(),
  }),
  z.object({ type: z.literal('result'), result: extractedTextSchema }),
  z.object({
    type: z.literal('failure'),
    code: z.enum(TEXT_EXTRACTION_ERROR_CODES),
    message: z.string(),
  }),
  z.object({ type: z.literal('crashed') }),
]);
export type ChildMessage = z.output<typeof childMessageSchema>;
