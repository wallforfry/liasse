import { Agent, get } from 'node:http';
import { createGate } from '@liasse/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { listen } from './listen.ts';

// Longer than the test timeout: a close that only ends when the grace cuts the
// connections fails the test instead of passing slowly.
const GRACE_MS = 120_000;

interface Answer {
  readonly status: number;
  readonly connection: string | undefined;
}

const request = (agent: Agent, port: number, path: string): Promise<Answer> =>
  new Promise((resolve, reject) => {
    get({ host: '127.0.0.1', port, path, agent }, (response) => {
      response.resume();
      response.on('end', () => {
        resolve({ status: response.statusCode ?? 0, connection: response.headers.connection });
      });
    }).on('error', reject);
  });

describe('listen', () => {
  const agents: Agent[] = [];
  afterEach(() => {
    agents.splice(0).forEach((agent) => {
      agent.destroy();
    });
  });

  it('stops serving a keep-alive connection that was busy when it closed', async () => {
    const held = createGate();
    const received = createGate();
    const listener = await listen({
      host: '127.0.0.1',
      port: 0,
      fetch: async (incoming) => {
        if (new URL(incoming.url).pathname === '/held') {
          received.open();
          await held.opened;
        }
        return new Response('ok');
      },
    });
    // One socket, kept alive: every request below travels on the same connection.
    const agent = new Agent({ keepAlive: true, maxSockets: 1 });
    agents.push(agent);
    expect(await request(agent, listener.port, '/')).toEqual({
      status: 200,
      connection: 'keep-alive',
    });

    const busy = request(agent, listener.port, '/held');
    await received.opened;
    const closed = listener.close(GRACE_MS);
    held.open();
    expect(await busy).toEqual({ status: 200, connection: 'keep-alive' });

    // The busy connection carries one more request, answered with the order to close it.
    expect(await request(agent, listener.port, '/')).toEqual({ status: 200, connection: 'close' });
    await closed;
    await expect(request(agent, listener.port, '/')).rejects.toMatchObject({
      code: 'ECONNREFUSED',
    });
  });
});
