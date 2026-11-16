import { StartupError } from '@liasse/core/domain';
import { z } from 'zod';

type Version = readonly [major: number, minor: number, patch: number];

interface AffectedRange {
  readonly from: Version;
  /** The first release with the fix. */
  readonly fixedIn: Version;
}

// Before these releases, the HTTP/1 client of undici calls `socket.setTypeOfService` without
// a `try` on the first request of a new connection. On macOS that call throws EINVAL when the
// peer has reset the connection, from a socket callback, so the throw is uncaught and ends
// the process (nodejs/undici#5547, backported to 7.x by nodejs/undici#6076). Undici 6, the
// one of Node 22, never makes that call. The 7.x range starts at 7.0.0 although the call
// appeared later (it is in 7.23.0), as `engines` rules out every Node 24 before 24.22.3.
const AFFECTED_UNDICI: readonly AffectedRange[] = [
  { from: [7, 0, 0], fixedIn: [7, 30, 2] },
  { from: [8, 0, 0], fixedIn: [8, 8, 0] },
];

const versionSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+/)
  .transform((text): Version => {
    const [major = 0, minor = 0, patch = 0] = text.split(/[.-]/, 3).map(Number);
    return [major, minor, patch];
  });

const compare = (left: Version, right: Version): number =>
  left[0] - right[0] || left[1] - right[1] || left[2] - right[2];

export const isAffectedUndici = (version: Version): boolean =>
  AFFECTED_UNDICI.some(
    ({ from, fixedIn }) => compare(version, from) >= 0 && compare(version, fixedIn) < 0,
  );

const SUPPORTED_NODE =
  'Node 22.12 or later on the 22 line, 24.22.3 or later on the 24 line, or 26.5.1 or later';

/**
 * Refuses a Node whose bundled undici, the one behind global `fetch`, can end the process on a
 * reset connection. `engines` only warns, and a server run from source does not read it.
 */
export const assertSupportedRuntime = (
  versions: Readonly<Record<string, string | undefined>> = process.versions,
): void => {
  const undici = versionSchema.safeParse(versions.undici);
  if (!undici.success) {
    throw new StartupError(
      `Liasse cannot tell which undici this Node bundles, so it cannot rule out nodejs/undici#5547. Use ${SUPPORTED_NODE}.`,
    );
  }
  if (isAffectedUndici(undici.data)) {
    throw new StartupError(
      `Liasse does not run on Node ${versions.node ?? 'of unknown version'}: its undici ` +
        `${undici.data.join('.')} can end the process on a reset connection (nodejs/undici#5547). ` +
        `Use ${SUPPORTED_NODE}.`,
    );
  }
};
