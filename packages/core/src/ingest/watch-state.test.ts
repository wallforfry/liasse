import { describe, expect, it } from 'vitest';
import { decide, forgetAbsent, type WatchState } from './watch-state.ts';

describe('decide', () => {
  it('starts over when the file changed, whatever its state was', () => {
    expect(decide({ phase: 'handled', fingerprint: '1:1' }, '2:2', 1000, 50)).toEqual({
      ingest: false,
      state: { phase: 'settling', fingerprint: '2:2', since: 1000 },
    });
  });

  it('ingests a file that held still for the stability delay, not sooner', () => {
    const settling = { phase: 'settling', fingerprint: '1:1', since: 1000 } as const;
    expect(decide(settling, '1:1', 1049, 50)).toEqual({ ingest: false, state: settling });
    expect(decide(settling, '1:1', 1050, 50)).toEqual({ ingest: true });
  });

  it('retries a failed file at its retry time, not sooner', () => {
    const failed = { phase: 'failed', fingerprint: '1:1', retryAt: 2000 } as const;
    expect(decide(failed, '1:1', 1999, 50)).toEqual({ ingest: false, state: failed });
    expect(decide(failed, '1:1', 2000, 50)).toEqual({ ingest: true });
  });

  it('never ingests a handled file again', () => {
    const handled = { phase: 'handled', fingerprint: '1:1' } as const;
    expect(decide(handled, '1:1', Number.MAX_SAFE_INTEGER, 50)).toEqual({
      ingest: false,
      state: handled,
    });
  });
});

describe('forgetAbsent', () => {
  const handled: WatchState = { phase: 'handled', fingerprint: '1:1' };

  it('keeps the listed paths and drops the others', () => {
    const states = new Map([
      ['/watched/kept.pdf', handled],
      ['/watched/removed.pdf', handled],
    ]);
    forgetAbsent(states, ['/watched/kept.pdf', '/watched/new.pdf']);
    expect([...states.keys()]).toEqual(['/watched/kept.pdf']);
  });

  // The watched folder is never emptied by Liasse and this runs at every scan, on the
  // event loop of the only process. Comparing every remembered path with every listed
  // one took 7 to 17 s at this size; one lookup per path takes a few milliseconds. The
  // bound sits far from both.
  it('stays fast on a folder of 50 000 files', () => {
    const paths = Array.from({ length: 50_000 }, (_, index) => `/watched/${String(index)}.pdf`);
    const states = new Map(paths.map((path) => [path, handled]));
    const started = performance.now();
    forgetAbsent(states, paths.slice(10));
    expect(performance.now() - started).toBeLessThan(2000);
    expect(states.size).toBe(49_990);
  });
});
