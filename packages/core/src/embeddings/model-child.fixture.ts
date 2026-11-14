import { setTimeout as delay } from 'node:timers/promises';
import { loadOnceUntilLoaded, serveModelRequests } from './model-channel.ts';

// A stand-in for the model process, served through the real channel. The first text decides
// what happens to the request that holds it.

// Anything written here must never reach the standard output of the server.
process.stdout.write('noise on the standard output of the model process\n');

const never = new Promise<never>(() => undefined);

// `overlap` answers how many embed requests are running once a second request reached the
// process: 1 when requests are served one at a time, 2 when they run side by side.
let running = 0;
let received = 0;
let secondReceived: () => void = () => undefined;
const second = new Promise<void>((resolve) => {
  secondReceived = resolve;
});
process.on('message', () => {
  received += 1;
  if (received === 2) secondReceived();
});

// Fails the first time it is asked, as a download that could not complete would.
let loads = 0;
const load = loadOnceUntilLoaded(() => {
  loads += 1;
  return loads === 1 ? Promise.reject(new Error('synthetic load failure')) : Promise.resolve(loads);
});

const obey = async (command: string | undefined): Promise<void> => {
  if (command === 'crash') process.exit(3);
  if (command === 'garbage') process.send?.({ unexpected: true });
  if (command === 'hang' || command === 'garbage') await never;
  // Holds the thread, as an inference that does not return: later requests are not read.
  if (command === 'block') Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
  if (command === 'slow') await delay(400);
  if (command === 'busy') setInterval(() => undefined, 1000);
  if (command === 'busy') await never;
  if (command === 'fail') throw new Error('synthetic model failure');
  if (command === 'load') await load();
  if (command === 'overlap') await second;
};

serveModelRequests({
  embed: async (texts) => {
    running += 1;
    try {
      await obey(texts[0]);
      // Read after a turn of the event loop: a request read meanwhile has started by then.
      await new Promise((resolve) => setImmediate(resolve));
      return texts.map((text) => [text === 'overlap' ? running : text.length, process.pid]);
    } finally {
      running -= 1;
    }
  },
  countTokens: async (texts) => {
    await obey(texts[0]);
    return texts.map((text) => (text === 'pid' ? process.pid : text.split(' ').length));
  },
});
