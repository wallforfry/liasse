import { type Answer, json, type Request } from '../../test/render.test-helper.tsx';

export const SOURCE = {
  id: 'src_01',
  kind: 'imap',
  name: 'Synthetic bills',
  enabled: true,
  poll_interval_minutes: 15,
  config: {
    host: 'imap.example.test',
    port: 993,
    security: 'tls',
    username: 'owner@example.test',
    mailboxes: ['INBOX', 'Bills'],
    start_date: '2026-01-01',
    from: 'billing@example.test',
    include_messages_without_attachments: false,
  },
  hint: 'Bills of the flat',
  private: false,
  secret: 'set',
  needs_attention: false,
  last_run: {
    started_at: '2026-11-18T08:00:00.000Z',
    finished_at: '2026-11-18T08:01:00.000Z',
    ingested: 3,
    duplicates: 1,
    skipped: 1,
    skipped_items: [
      {
        external_id: 'INBOX:1:7',
        name: 'Huge scan.eml',
        reason: 'The file is over max_file_size.',
      },
    ],
    error: null,
  },
  created_at: '2026-11-01T08:00:00.000Z',
  updated_at: '2026-11-01T08:00:00.000Z',
} as const;

/** A Drive source not connected to Google yet. */
export const DRIVE_SOURCE = {
  id: 'src_02',
  kind: 'gdrive',
  name: 'Synthetic scans',
  enabled: true,
  poll_interval_minutes: 15,
  config: { folder_id: '1SyntheticFolder_id-42' },
  hint: null,
  private: false,
  secret: 'unset',
  needs_attention: false,
  last_run: null,
  created_at: '2026-11-01T08:00:00.000Z',
  updated_at: '2026-11-01T08:00:00.000Z',
} as const;

export const CONSENT_URL = 'https://accounts.google.example.test/o/oauth2/v2/auth?state=synthetic';

export const isList = ({ method, path }: Request) => method === 'GET' && path === '/sources';
export const isCreate = ({ method, path }: Request) => method === 'POST' && path === '/sources';
// Any one source: the fake server answers its read and its save with the first it holds.
const ONE_SOURCE = /^\/sources\/src_\w+$/u;

export const isRead = ({ method, path }: Request) => method === 'GET' && ONE_SOURCE.test(path);
export const isPatch = ({ method, path }: Request) => method === 'PATCH' && ONE_SOURCE.test(path);
export const isDelete = ({ method, path }: Request) =>
  method === 'DELETE' && path === `/sources/${SOURCE.id}`;
export const isCheck = ({ method, path }: Request) =>
  method === 'POST' && /^\/sources\/src_\w+\/check$/u.test(path);
export const isRun = ({ method, path }: Request) =>
  method === 'POST' && path === `/sources/${SOURCE.id}/run`;
export const isAuthorize = ({ method, path }: Request) =>
  method === 'POST' && /^\/sources\/[^/]+\/google\/authorize$/u.test(path);
export const isComplete = ({ method, path }: Request) =>
  method === 'POST' && path === '/sources/google/complete';

/**
 * A server holding `sources`, which answers a read and a save with the first of them, a
 * check with `check`, a run with `run`, a deletion with 204, the start of a consent with
 * `authorize` and its end with `complete`, unless `saved` answers a save.
 */
export const sourcesServer = ({
  sources = [SOURCE],
  saved,
  check = { ok: true, items: [{ name: 'Invoice 42.eml' }] },
  run = () => json({ queued: true }, 202),
  authorize = () => json({ url: CONSENT_URL }),
  complete = () => json({ outcome: 'connected', source_id: DRIVE_SOURCE.id }),
}: {
  readonly sources?: readonly unknown[];
  readonly saved?: Answer;
  readonly check?: unknown;
  readonly run?: Answer;
  readonly authorize?: Answer;
  readonly complete?: Answer;
} = {}): Answer => {
  const answerSave = saved ?? (() => json(sources[0]));
  return (request) => {
    if (isList(request)) return json({ sources });
    if (isRead(request)) return json(sources[0]);
    if (isCreate(request) || isPatch(request)) return answerSave(request);
    if (isDelete(request)) return new Response(null, { status: 204 });
    if (isCheck(request)) return json(check);
    if (isRun(request)) return run(request);
    if (isAuthorize(request)) return authorize(request);
    if (isComplete(request)) return complete(request);
    return undefined;
  };
};
