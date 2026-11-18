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

export const isList = ({ method, path }: Request) => method === 'GET' && path === '/sources';
export const isCreate = ({ method, path }: Request) => method === 'POST' && path === '/sources';
export const isRead = ({ method, path }: Request) =>
  method === 'GET' && path === `/sources/${SOURCE.id}`;
export const isPatch = ({ method, path }: Request) =>
  method === 'PATCH' && path === `/sources/${SOURCE.id}`;
export const isDelete = ({ method, path }: Request) =>
  method === 'DELETE' && path === `/sources/${SOURCE.id}`;
export const isCheck = ({ method, path }: Request) =>
  method === 'POST' && path === `/sources/${SOURCE.id}/check`;
export const isRun = ({ method, path }: Request) =>
  method === 'POST' && path === `/sources/${SOURCE.id}/run`;

/**
 * A server holding `sources`, which answers a read and a save with the first of them, a
 * check with `check`, a run with `run` and a deletion with 204, unless `saved` answers a save.
 */
export const sourcesServer = ({
  sources = [SOURCE],
  saved,
  check = { ok: true, items: [{ name: 'Invoice 42.eml' }] },
  run = () => json({ queued: true }, 202),
}: {
  readonly sources?: readonly unknown[];
  readonly saved?: Answer;
  readonly check?: unknown;
  readonly run?: Answer;
} = {}): Answer => {
  const answerSave = saved ?? (() => json(sources[0]));
  return (request) => {
    if (isList(request)) return json({ sources });
    if (isRead(request)) return json(sources[0]);
    if (isCreate(request) || isPatch(request)) return answerSave(request);
    if (isDelete(request)) return new Response(null, { status: 204 });
    if (isCheck(request)) return json(check);
    if (isRun(request)) return run(request);
    return undefined;
  };
};
