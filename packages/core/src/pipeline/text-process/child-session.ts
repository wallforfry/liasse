import { type ChildProcess, fork } from 'node:child_process';
import { z } from 'zod';
import { TextExtractionError } from '../../text/errors.ts';
import { resolveTextLimits } from '../../text/limits.ts';
import type { ExtractedText, ExtractTextDeps, ExtractTextInput } from '../../text/types.ts';
import { DEFAULT_TEXT_PROCESS_LIMITS, TextProcessError, type TextProcessLimits } from './limits.ts';
import { type ChildMessage, childMessageSchema, type ParentMessage } from './protocol.ts';
import { VERDICT_FD, WATCHDOG_VERDICTS } from './verdict.ts';

// Node runs the TypeScript sources directly in development and in tests, and the compiled
// files once built: the child entry has the extension of this very file.
const RUNS_FROM_SOURCE = import.meta.url.endsWith('.ts');
const SOURCE_FLAGS = ['--experimental-strip-types', '--disable-warning=ExperimentalWarning'];

export const EXTRACTION_CHILD_ENTRY = new URL(
  `./extract-child.${RUNS_FROM_SOURCE ? 'ts' : 'js'}`,
  import.meta.url,
);

export interface ExtractInChildDeps extends ExtractTextDeps {
  readonly processLimits?: Partial<TextProcessLimits>;
}

export interface ChildSessionOptions {
  readonly entry: URL;
  readonly onSpawn?: (pid: number | undefined) => void;
}

type Outcome =
  | { readonly ok: true; readonly text: ExtractedText }
  | { readonly ok: false; readonly error: unknown };

const failed = (error: unknown): Outcome => ({ ok: false, error });
const crashed = (): Outcome => failed(new TextProcessError('text_process_crashed'));

// The child's stdout is discarded: pdfjs prints its warnings there, and the server's own
// stdout may carry a protocol (MCP over stdio). The fifth entry is the watchdog's verdict.
const spawnChild = (entry: URL, limits: TextProcessLimits): ChildProcess =>
  fork(entry, [String(limits.maxRssBytes), String(limits.maxCpuMs)], {
    execArgv: [
      ...(RUNS_FROM_SOURCE ? SOURCE_FLAGS : []),
      `--max-old-space-size=${String(limits.maxOldSpaceMb)}`,
    ],
    serialization: 'advanced',
    stdio: ['ignore', 'ignore', 'inherit', 'ipc', 'pipe'],
  });

const verdictSchema = z.enum(WATCHDOG_VERDICTS);

// Why a child nobody ended is gone. V8 aborts the process when its heap reaches
// `--max-old-space-size`: that is the memory limit too, enforced without the watchdog.
const deathCause = (verdict: string, signalName: NodeJS.Signals | null): TextProcessError => {
  const reason = verdictSchema.safeParse(verdict).data;
  if (reason === 'memory' || signalName === 'SIGABRT') {
    return new TextProcessError('text_memory_limit');
  }
  return new TextProcessError(reason === 'cpu' ? 'text_cpu_limit' : 'text_process_crashed');
};

const toExtractedText = ({
  visionModel,
  ...text
}: Extract<ChildMessage, { type: 'result' }>['result']): ExtractedText => ({
  ...text,
  ...(visionModel === undefined ? {} : { visionModel }),
});

// Runs one extraction in a process of its own and resolves once that process is gone,
// whatever the outcome: the first outcome wins and ends the child.
export const extractWithProcess = async (
  { entry, onSpawn }: ChildSessionOptions,
  { bytes, mime }: ExtractTextInput,
  { vision, signal, limits, pdfRenderer, processLimits }: ExtractInChildDeps,
): Promise<ExtractedText> => {
  signal?.throwIfAborted();
  const child = spawnChild(entry, { ...DEFAULT_TEXT_PROCESS_LIMITS, ...processLimits });
  onSpawn?.(child.pid);
  let outcome: Outcome | undefined;
  let verdict = '';

  const decide = (decided: Outcome): void => {
    if (outcome !== undefined) return;
    outcome = decided;
    child.kill('SIGKILL');
  };
  const abort = (): void => {
    decide(failed(signal?.reason));
  };
  const tell = (message: ParentMessage): void => {
    child.send(message, (error) => {
      if (error !== null) decide(crashed());
    });
  };
  // A failed vision call fails the extraction, and its caller decides on a retry from
  // the error itself: it is handed over as it is, not as the child would describe it.
  const transcribe = async ({
    id,
    ...page
  }: Extract<ChildMessage, { type: 'vision' }>): Promise<void> => {
    try {
      const { image, mime: imageMime, prompt } = page;
      const { markdown, model } = await vision.transcribePage({
        image,
        mime: imageMime,
        prompt,
        ...(signal === undefined ? {} : { signal }),
      });
      tell({ type: 'vision_result', id, markdown, model });
    } catch (error) {
      decide(failed(error));
    }
  };
  const receive = (message: ChildMessage): void => {
    switch (message.type) {
      case 'ready':
        tell({
          type: 'extract',
          bytes,
          mime,
          limits: resolveTextLimits(limits),
          pdfRenderer: pdfRenderer ?? {},
        });
        return;
      case 'vision':
        void transcribe(message);
        return;
      case 'result':
        decide({ ok: true, text: toExtractedText(message.result) });
        return;
      case 'failure':
        decide(failed(new TextExtractionError(message.code, message.message)));
        return;
      case 'crashed':
        decide(crashed());
    }
  };

  signal?.addEventListener('abort', abort, { once: true });
  child.stdio[VERDICT_FD]?.on('data', (chunk: Buffer) => {
    verdict += chunk.toString('latin1');
  });
  child.on('message', (received) => {
    const message = childMessageSchema.safeParse(received);
    if (message.success) receive(message.data);
    else decide(crashed());
  });
  const final = await new Promise<Outcome>((resolve) => {
    child.once('close', (_code, signalName) => {
      resolve(outcome ?? failed(deathCause(verdict, signalName)));
    });
    child.once('error', () => {
      resolve(outcome ?? crashed());
    });
  });
  signal?.removeEventListener('abort', abort);
  if (!final.ok) throw final.error;
  return final.text;
};
