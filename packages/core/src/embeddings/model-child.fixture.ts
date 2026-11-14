import { modelRequestSchema, type ModelResponse } from './model-protocol.ts';

// A stand-in for the model process. A text decides what happens to the request that holds it.
const COMMANDS = {
  crash: () => process.exit(3),
  hang: () => undefined,
  garbage: () => process.send?.({ unexpected: true }),
} as const;

const isCommand = (text: string | undefined): text is keyof typeof COMMANDS =>
  text !== undefined && text in COMMANDS;

// Anything written here must never reach the standard output of the server.
process.stdout.write('noise on the standard output of the model process\n');

process.on('message', (message) => {
  const { id, kind, texts } = modelRequestSchema.parse(message);
  const [first] = texts;
  if (isCommand(first)) {
    COMMANDS[first]();
    return;
  }
  const response: ModelResponse =
    first === 'fail'
      ? { id, outcome: 'failure', message: 'synthetic model failure' }
      : kind === 'embed'
        ? { id, outcome: 'vectors', vectors: texts.map((text) => [text.length, process.pid]) }
        : { id, outcome: 'counts', counts: texts.map((text) => text.split(' ').length) };
  process.send?.(response);
});

process.on('disconnect', () => process.exit(0));
