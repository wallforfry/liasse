import { once } from 'node:events';
import { Worker } from 'node:worker_threads';
import type { TranscribePageResult, VisionModel } from '../../models/ports.ts';
import { TextExtractionError } from '../../text/errors.ts';
import { extractText } from '../../text/extract-text.ts';
import { type ChildMessage, type ParentMessage, parentMessageSchema } from './protocol.ts';

// Entry point of the process that reads one document. It lives for one extraction: the
// server ends it as soon as it has the answer, which is also what frees the memory.

// pdfjs warns on stderr, each time it is imported, that an optional canvas package is
// missing. In a process per document that is several lines per PDF in the server's log.
console.warn = () => undefined;

const WATCHDOG_ENTRY = new URL(
  `./watchdog.${import.meta.url.endsWith('.ts') ? 'ts' : 'js'}`,
  import.meta.url,
);
// An exception in the watchdog, its refusal of the limits included, is an `error` event
// nobody listens to: it ends this process, which never runs unwatched.
const watchdog = new Worker(WATCHDOG_ENTRY, { argv: process.argv.slice(2) });
await once(watchdog, 'message');

// The server is gone, or going: nobody is left to answer to.
const leave = (): never => process.exit(0);

const send = (message: ChildMessage): void => {
  process.send?.(message, (error) => {
    if (error !== null) leave();
  });
};

type Transcribed = (result: TranscribePageResult) => void;
const transcriptions = new Map<number, Transcribed>();

// The provider credentials stay in the server: a page is sent there to be transcribed.
// A call the server could not answer is never answered here, because the server ends
// this process as it reports the failure.
const vision: VisionModel = {
  transcribePage: ({ image, mime, prompt }) =>
    new Promise((resolve) => {
      const id = transcriptions.size + 1;
      transcriptions.set(id, resolve);
      send({ type: 'vision', id, image, mime, prompt });
    }),
};

type Extraction = Extract<ParentMessage, { type: 'extract' }>;

const withoutUndefined = ({ command, infoCommand, tempRoot }: Extraction['pdfRenderer']) => ({
  ...(command === undefined ? {} : { command }),
  ...(infoCommand === undefined ? {} : { infoCommand }),
  ...(tempRoot === undefined ? {} : { tempRoot }),
});

const extract = async ({ bytes, mime, limits, pdfRenderer }: Extraction): Promise<ChildMessage> => {
  try {
    const result = await extractText(
      { bytes, mime },
      { vision, limits, pdfRenderer: withoutUndefined(pdfRenderer) },
    );
    return { type: 'result', result };
  } catch (error) {
    return error instanceof TextExtractionError
      ? { type: 'failure', code: error.code, message: error.message }
      : { type: 'crashed' };
  }
};

process.on('message', (received) => {
  const message = parentMessageSchema.parse(received);
  if (message.type === 'extract') {
    void extract(message).then(send);
    return;
  }
  transcriptions.get(message.id)?.({ markdown: message.markdown, model: message.model });
});
process.on('disconnect', leave);
send({ type: 'ready' });
