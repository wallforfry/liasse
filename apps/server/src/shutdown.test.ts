import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { installShutdown } from './shutdown.ts';

const setup = (serverError?: Error) => {
  const signals = new EventEmitter();
  const events: string[] = [];
  const pendingServerCloses: ((error?: Error) => void)[] = [];
  installShutdown({
    signals,
    server: {
      close: (callback) => {
        events.push('server.close');
        pendingServerCloses.push(callback);
      },
    },
    database: {
      close: () => {
        events.push('database.close');
        return Promise.resolve();
      },
    },
  });
  const finishServerClose = (): void => {
    pendingServerCloses.splice(0).forEach((callback) => {
      callback(serverError);
    });
  };
  return { signals, events, finishServerClose };
};

describe('installShutdown', () => {
  it('closes nothing before a signal', () => {
    expect(setup().events).toEqual([]);
  });

  it.each(['SIGTERM', 'SIGINT'])('closes the server, then the database, on %s', (signal) => {
    const { signals, events, finishServerClose } = setup();
    signals.emit(signal);
    expect(events).toEqual(['server.close']);
    finishServerClose();
    expect(events).toEqual(['server.close', 'database.close']);
  });

  it('closes the server and the database exactly once when signals repeat', () => {
    const { signals, events, finishServerClose } = setup();
    signals.emit('SIGTERM');
    signals.emit('SIGINT');
    signals.emit('SIGTERM');
    finishServerClose();
    signals.emit('SIGINT');
    finishServerClose();
    expect(events).toEqual(['server.close', 'database.close']);
  });

  it('still closes the database when the server fails to close', () => {
    const { signals, events, finishServerClose } = setup(new Error('server is not running'));
    signals.emit('SIGTERM');
    finishServerClose();
    expect(events).toEqual(['server.close', 'database.close']);
  });

  it('ignores other signals', () => {
    const { signals, events } = setup();
    signals.emit('SIGHUP');
    expect(events).toEqual([]);
  });
});
