import { describe, expect, it } from 'vitest';
import { DriveFileRefusedError, DriveUnauthorizedError } from './drive-api.ts';
import { refusalOf, refusalReasons } from './drive-refusal.ts';

const errorBody = (...reasons: readonly string[]) =>
  JSON.stringify({
    error: { code: 403, message: 'Refused.', errors: reasons.map((reason) => ({ reason })) },
  });

describe('refusalReasons', () => {
  it("reads the reasons of Drive's error body", async () => {
    const response = new Response(errorBody('cannotDownloadFile', 'other'), { status: 403 });

    expect(await refusalReasons(response)).toEqual(['cannotDownloadFile', 'other']);
  });

  it.each([
    ['text that is not JSON', '<html>Forbidden</html>'],
    ['JSON of another shape', '{"message":"Forbidden"}'],
    ['no body', null],
  ])('gives no reason for %s', async (_, body) => {
    expect(await refusalReasons(new Response(body, { status: 403 }))).toEqual([]);
  });

  it('reads no further than an error body could be', async () => {
    const padded = `${errorBody('cannotDownloadFile').slice(0, -1)},"padding":"${'x'.repeat(70_000)}"}`;

    expect(await refusalReasons(new Response(padded, { status: 403 }))).toEqual([]);
  });

  it('gives up a body that does not come', async () => {
    const stalled = new ReadableStream<Uint8Array>({
      start: (controller) => {
        controller.enqueue(new TextEncoder().encode('{"error":'));
      },
    });

    expect(await refusalReasons(new Response(stalled, { status: 403 }), 10)).toEqual([]);
  });
});

describe('refusalOf', () => {
  const refused = (status: number, reasons: readonly string[], perFile = true) =>
    refusalOf({ status, call: 'files', reasons, perFile });

  it('refuses the authorization on 401', () => {
    expect(refused(401, [])).toBeInstanceOf(DriveUnauthorizedError);
  });

  it('takes any 429 for a limit, with or without a reason', () => {
    const error = refused(429, []);

    expect(error).not.toBeInstanceOf(DriveFileRefusedError);
    expect(error.message).toBe(
      'Drive limits requests or downloads for now: a later attempt resumes.',
    );
  });

  it('refuses the one file on a download refused with 403 and a reason about it', () => {
    const error = refused(403, ['cannotDownloadAbusiveFile']);

    expect(error).toBeInstanceOf(DriveFileRefusedError);
    expect(error.message).toContain('(cannotDownloadAbusiveFile)');
  });

  it.each([
    ['another status', 500, true],
    ['a request that reads no bytes', 403, false],
  ])('never refuses the one file for %s', (_, status, perFile) => {
    const error = refused(status, ['cannotDownloadFile'], perFile);

    expect(error).not.toBeInstanceOf(DriveFileRefusedError);
    expect(error.message).toBe(`Drive answered ${String(status)} to files (cannotDownloadFile).`);
  });

  it('names only the reasons that are plain codes', () => {
    expect(refused(403, ['domainPolicy', 'a reason, quoted\nfrom the server']).message).toBe(
      'Drive answered 403 to files (domainPolicy).',
    );
  });
});
