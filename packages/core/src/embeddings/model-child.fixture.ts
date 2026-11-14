import { setTimeout as delay } from 'node:timers/promises';
import { loadOnceUntilLoaded, serveModelRequests } from './model-channel.ts';

// A stand-in for the model process, served through the real channel. The first text decides
// what happens to the request that holds it.

// Anything written here must never reach the standard output of the server.
process.stdout.write('noise on the standard output of the model process\n');

const never = new Promise<never>(() => undefined);

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
  if (command === 'slow') await delay(400);
  if (command === 'busy') setInterval(() => undefined, 1000);
  if (command === 'busy') await never;
  if (command === 'fail') throw new Error('synthetic model failure');
  if (command === 'load') await load();
};

serveModelRequests({
  embed: async (texts) => {
    await obey(texts[0]);
    return texts.map((text) => [text.length, process.pid]);
  },
  countTokens: async (texts) => {
    await obey(texts[0]);
    return texts.map((text) => (text === 'pid' ? process.pid : text.split(' ').length));
  },
});
