import { StartupError } from '@liasse/core/domain';
import { describe, expect, it } from 'vitest';
import { assertSupportedRuntime, isAffectedUndici } from './supported-runtime.ts';

describe('isAffectedUndici', () => {
  it.each([
    [[7, 0, 0]],
    [[7, 24, 4]],
    [[7, 28, 0]],
    [[7, 30, 1]],
    [[8, 0, 2]],
    [[8, 7, 0]],
  ] as const)('holds for undici %j, which calls setTypeOfService unguarded', (version) => {
    expect(isAffectedUndici(version)).toBe(true);
  });

  it.each([
    [[6, 21, 0]],
    [[6, 29, 1]],
    [[7, 30, 2]],
    [[7, 31, 0]],
    [[8, 8, 0]],
    [[8, 12, 4]],
    [[9, 0, 0]],
  ] as const)('does not hold for undici %j', (version) => {
    expect(isAffectedUndici(version)).toBe(false);
  });
});

describe('assertSupportedRuntime', () => {
  it('accepts the undici of Node 22, 24.22.3 and 26.5.1', () => {
    expect(() => {
      assertSupportedRuntime({ node: '22.23.5', undici: '6.29.1' });
    }).not.toThrow();
    expect(() => {
      assertSupportedRuntime({ node: '24.22.3', undici: '7.30.2' });
    }).not.toThrow();
    expect(() => {
      assertSupportedRuntime({ node: '26.5.1', undici: '8.9.0' });
    }).not.toThrow();
  });

  it('refuses the undici of Node 24.18 and names the supported versions', () => {
    expect(() => {
      assertSupportedRuntime({ node: '24.18.0', undici: '7.28.0' });
    }).toThrow(
      new StartupError(
        'Liasse does not run on Node 24.18.0: its undici 7.28.0 can end the process on a reset ' +
          'connection (nodejs/undici#5547). Use Node 22.12 or later on the 22 line, 24.22.3 or ' +
          'later on the 24 line, or 26.5.1 or later.',
      ),
    );
  });

  it.each(['7.30.1-pre', '7.30.1+x', '7.30.1-rc.1+build.5'])(
    'reads undici %s by its release numbers',
    (undici) => {
      expect(() => {
        assertSupportedRuntime({ node: '24.22.2', undici });
      }).toThrow('its undici 7.30.1 can end the process');
    },
  );

  it.each([undefined, 'unknown', '7.30', '7.30.2x', ' 7.30.2', 'v7.30.2'])(
    'refuses a Node whose undici reads %j',
    (undici) => {
      expect(() => {
        assertSupportedRuntime(
          undici === undefined ? { node: '24.18.0' } : { node: '24.18.0', undici },
        );
      }).toThrow(
        new StartupError(
          'Liasse cannot tell which undici this Node bundles, so it cannot rule out ' +
            'nodejs/undici#5547. Use Node 22.12 or later on the 22 line, 24.22.3 or later on ' +
            'the 24 line, or 26.5.1 or later.',
        ),
      );
    },
  );
});
