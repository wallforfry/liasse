import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ModelProviderError } from '../../models/errors.ts';
import { z } from 'zod';
import { createGate, sleep } from '../../testing/async.ts';
import { createFakeVisionModel } from '../../testing/fake-vision-model.ts';
import { buildSyntheticDocx } from '../../testing/synthetic-docx.ts';
import { buildSyntheticPdf } from '../../testing/synthetic-pdf.ts';
import { TextExtractionError } from '../../text/errors.ts';
import { extractText } from '../../text/extract-text.ts';
import type { ExtractTextInput } from '../../text/types.ts';
import {
  CHILD_ENVIRONMENT,
  type ExtractInChildDeps,
  EXTRACTION_CHILD_ENTRY,
  extractWithProcess,
} from './child-session.ts';
import { extractTextInChild, TextProcessError } from './extract-in-child.ts';
import { buildHostilePdf } from './hostile-pdf.test-helper.ts';

const MEBIBYTE = 1024 * 1024;
const LOW_MEMORY_LIMIT = { maxRssBytes: 256 * MEBIBYTE };

const pdf = (pages: Parameters<typeof buildSyntheticPdf>[0]): ExtractTextInput => ({
  bytes: buildSyntheticPdf(pages),
  mime: 'application/pdf',
});

const LINES = Array.from(
  { length: 12 },
  (_, index) => `Line ${String(index + 1)} of a synthetic statement with enough words to be native`,
);
const NATIVE = pdf([{ lines: LINES }, { lines: [...LINES, 'Second page'] }]);
const SCANNED = pdf([{ scanned: true }, { scanned: true }]);

const BINARY = Uint8Array.from({ length: 256 }, (_, index) => index);
const EMAIL: ExtractTextInput = {
  mime: 'message/rfc822',
  bytes: Buffer.from(
    [
      'From: Sender <sender@example.com>',
      'To: recipient@example.org',
      'Subject: Synthetic message with an attachment',
      'Date: Mon, 02 Nov 2026 10:00:00 +0000',
      'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary="synthetic-boundary"',
      '',
      '--synthetic-boundary',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Please find the statement attached.',
      '--synthetic-boundary',
      'Content-Type: application/octet-stream; name="data.bin"',
      'Content-Disposition: attachment; filename="data.bin"',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from(BINARY).toString('base64'),
      '--synthetic-boundary--',
      '',
    ].join('\r\n'),
    'latin1',
  ),
};

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const spawned: number[] = [];
const onSpawn = (pid: number | undefined): void => {
  if (pid !== undefined) spawned.push(pid);
};

const run = (
  input: ExtractTextInput,
  deps: Partial<ExtractInChildDeps> = {},
  entry: URL = EXTRACTION_CHILD_ENTRY,
) => extractWithProcess({ entry, onSpawn }, input, { vision: createFakeVisionModel(), ...deps });

const failureOf = async (extraction: Promise<unknown>): Promise<unknown> =>
  extraction.then(
    () => {
      throw new Error('The extraction succeeded');
    },
    (error: unknown) => error,
  );

afterEach(() => {
  const started = spawned.splice(0);
  expect(started.filter(isAlive)).toEqual([]);
});

describe('extractTextInChild', () => {
  it('returns what extractText returns for a native PDF', async () => {
    const vision = createFakeVisionModel();
    const inChild = await extractTextInChild(NATIVE, { vision });
    expect(inChild).toEqual(await extractText(NATIVE, { vision }));
    expect(inChild.pages).toHaveLength(2);
    expect(inChild.method).toBe('native');
  });

  it('starts one process per extraction and leaves none behind', async () => {
    await run(NATIVE);
    await run(NATIVE);
    expect(new Set(spawned).size).toBe(2);
    expect(spawned.filter(isAlive)).toEqual([]);
  });

  it('transcribes scanned pages with the vision model of the parent', async () => {
    const vision = createFakeVisionModel(() => 'Transcribed page');
    const text = await run(SCANNED, { vision });
    expect(vision.calls).toHaveLength(2);
    expect(vision.calls.every(({ image }) => image.length > 0)).toBe(true);
    expect(text.pages.map(({ text: page, method }) => [page, method])).toEqual([
      ['Transcribed page', 'vision'],
      ['Transcribed page', 'vision'],
    ]);
    expect(text.method).toBe('vision');
    expect(text.visionModel).toBe('fake-vision-model');
  });

  it('gives the vision call the signal of the caller', async () => {
    const { signal } = new AbortController();
    const vision = createFakeVisionModel(() => 'Transcribed page');
    await run(SCANNED, { vision, signal });
    expect(vision.calls.map((call) => call.signal)).toEqual([signal, signal]);
  });

  it('brings the bytes of an email attachment back unchanged', async () => {
    const { attachments, pages } = await run(EMAIL);
    expect(pages[0]?.text).toContain('Please find the statement attached.');
    expect(attachments).toHaveLength(1);
    const [attachment] = attachments;
    expect(attachment).toMatchObject({ filename: 'data.bin', inline: false });
    expect([...(attachment?.bytes ?? [])]).toEqual([...BINARY]);
  });

  it('forwards the text limits and the renderer options to the child', async () => {
    const tooLong = await failureOf(run(NATIVE, { limits: { maxPdfPages: 1 } }));
    expect(tooLong).toMatchObject({ code: 'pdf_too_many_pages' });
    const noRenderer = await failureOf(
      run(SCANNED, { pdfRenderer: { infoCommand: '/nonexistent/synthetic-pdfinfo' } }),
    );
    expect(noRenderer).toMatchObject({ code: 'pdf_renderer_missing' });
  });
});

describe('a failure of the extraction', () => {
  it('keeps the code of a TextExtractionError, and with it the retry decision', async () => {
    const encrypted: ExtractTextInput = {
      bytes: buildSyntheticPdf([{ lines: LINES }], { userPassword: 'synthetic-password' }),
      mime: 'application/pdf',
    };
    const error = await failureOf(run(encrypted));
    expect(error).toBeInstanceOf(TextExtractionError);
    expect(error).toMatchObject({
      code: 'pdf_encrypted',
      retryable: false,
      message: 'The PDF is protected by a password',
    });
  });

  it('rethrows the very error of a failed vision call', async () => {
    const failure = new ModelProviderError({
      provider: 'synthetic',
      model: 'fake-vision-model',
      retryable: true,
      statusCode: 503,
    });
    const vision = createFakeVisionModel(() => {
      throw failure;
    });
    expect(await failureOf(run(SCANNED, { vision }))).toBe(failure);
  });

  it('ends the child and rejects with the reason when the signal aborts', async () => {
    const controller = new AbortController();
    const reason = new Error('synthetic abort');
    const never = createGate();
    const vision = createFakeVisionModel(async () => {
      controller.abort(reason);
      await never.opened;
      return '';
    });
    // One page: a second call would find the signal aborted and fail by itself.
    const onePage = pdf([{ scanned: true }]);
    expect(await failureOf(run(onePage, { vision, signal: controller.signal }))).toBe(reason);
    expect(vision.calls).toHaveLength(1);
    expect(spawned).toHaveLength(1);
  });

  it('starts no process for a signal that is already aborted', async () => {
    const reason = new Error('synthetic abort');
    expect(await failureOf(run(NATIVE, { signal: AbortSignal.abort(reason) }))).toBe(reason);
    expect(spawned).toEqual([]);
  });

  it('reports a child that exits before answering as a retryable crash', async () => {
    const entry = new URL('./exiting-child.test-helper.ts', import.meta.url);
    const error = await failureOf(run(NATIVE, {}, entry));
    expect(error).toBeInstanceOf(TextProcessError);
    expect(error).toMatchObject({ code: 'text_process_crashed', retryable: true });
  });

  it('ends a child that sends something else than a protocol message', async () => {
    const entry = new URL('./babbling-child.test-helper.ts', import.meta.url);
    const error = await failureOf(run(NATIVE, {}, entry));
    expect(error).toMatchObject({ code: 'text_process_crashed', retryable: true });
  });

  // Verdict R4: the child parses hostile files; the credentials stay in the server.
  it('gives the child no variable of the server but what Node and poppler need', async () => {
    process.env.LIASSE_TEST_CANARY_API_KEY = 'synthetic-canary-secret';
    try {
      const entry = new URL('./env-child.test-helper.ts', import.meta.url);
      const error = await failureOf(run(NATIVE, {}, entry));
      expect(error).toBeInstanceOf(TextExtractionError);
      const seen = z
        .object({ keys: z.array(z.string()), canary: z.string().nullable() })
        .parse(JSON.parse(error instanceof Error ? error.message : '{}'));
      expect(seen.canary).toBeNull();
      expect(seen.keys).toContain('PATH');
      // macOS adds this one to the environment of every process it starts.
      const injected = (key: string) => key === '__CF_USER_TEXT_ENCODING';
      expect(seen.keys.filter((key) => !CHILD_ENVIRONMENT.includes(key) && !injected(key))).toEqual(
        [],
      );
    } finally {
      delete process.env.LIASSE_TEST_CANARY_API_KEY;
    }
  });

  // Verdict R5: no processor time is spent, so only the clock can end it.
  it('ends a child that stops answering, with a coded error another attempt may not meet', async () => {
    const entry = new URL('./silent-child.test-helper.ts', import.meta.url);
    const error = await failureOf(run(NATIVE, { processLimits: { maxIdleMs: 200 } }, entry));
    expect(error).toBeInstanceOf(TextProcessError);
    expect(error).toMatchObject({ code: 'text_process_timeout', retryable: true });
  });

  it('does not count the time a vision call takes as silence', async () => {
    const entry = new URL('./waiting-child.test-helper.ts', import.meta.url);
    const vision = createFakeVisionModel(async () => {
      await sleep(1500);
      return 'Transcribed after a long wait';
    });
    const text = await run(NATIVE, { vision, processLimits: { maxIdleMs: 1000 } }, entry);
    expect(text.pages[0]?.text).toBe('Transcribed after a long wait');
  });

  it('takes the reason of a child from its first verdict, however it then ends', async () => {
    const entry = new URL('./repeating-child.test-helper.ts', import.meta.url);
    const error = await failureOf(run(NATIVE, {}, entry));
    expect(error).toMatchObject({ code: 'text_cpu_limit', retryable: false });
  });
});

describe('the limits of the extraction process', () => {
  let hostile: ExtractTextInput;

  beforeAll(async () => {
    hostile = { bytes: await buildHostilePdf(300), mime: 'application/pdf' };
  });

  it('ends a child whose memory passes the limit, and says the bytes will fail again', async () => {
    expect(hostile.bytes.length).toBeLessThan(MEBIBYTE);
    const error = await failureOf(run(hostile, { processLimits: LOW_MEMORY_LIMIT }));
    expect(error).toBeInstanceOf(TextProcessError);
    expect(error).toMatchObject({ code: 'text_memory_limit', retryable: false });
  });

  it('lets a legitimate document through under the same memory limit', async () => {
    const text = await run(NATIVE, { processLimits: LOW_MEMORY_LIMIT });
    expect(text.pages).toHaveLength(2);
  });

  // V8 prints its out-of-memory report on the stderr this test run shares with the child.
  it('reports a heap that reaches its own limit as the memory limit', async () => {
    const paragraph = '<w:p><w:r><w:t>Paragraph of a synthetic document.</w:t></w:r></w:p>';
    const docx: ExtractTextInput = {
      bytes: buildSyntheticDocx(paragraph.repeat(40_000)),
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
    expect((await run(docx)).pages).toHaveLength(1);
    const error = await failureOf(run(docx, { processLimits: { maxOldSpaceMb: 16 } }));
    expect(error).toMatchObject({ code: 'text_memory_limit', retryable: false });
  });

  it('runs no extraction under a limit the watchdog cannot enforce', async () => {
    const error = await failureOf(run(NATIVE, { processLimits: { maxRssBytes: Number.NaN } }));
    expect(error).toMatchObject({ code: 'text_process_crashed' });
  });

  it('ends a child whose processor time passes the limit', async () => {
    const error = await failureOf(run(NATIVE, { processLimits: { maxCpuMs: 1 } }));
    expect(error).toBeInstanceOf(TextProcessError);
    expect(error).toMatchObject({ code: 'text_cpu_limit', retryable: false });
  });
});
