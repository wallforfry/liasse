import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeServer, json, renderApp } from '../../test/render.test-helper.tsx';

const CHANGE = {
  id: 'chg_01KCHANGE0000000000000001',
  kind: 'merge',
  payload: { source_id: 'typ_a', target_id: 'typ_b', field_mapping: {}, confidence: 0.6 },
  rationale: 'Both are bills.',
  status: 'pending',
  auto: false,
  created_at: '2026-11-15T03:00:00.000Z',
  decided_at: null,
  note: null,
};

const serverWithOneChange = () => {
  let decided = false;
  return fakeServer((request) => {
    if (request.method === 'POST' && request.path === `/changes/${CHANGE.id}`) {
      decided = true;
      return json({
        change: { ...CHANGE, status: 'rejected', decided_at: '2026-11-15T09:00:00.000Z' },
        documents_to_reextract: 0,
      });
    }
    if (request.path === '/changes') {
      return json({ changes: decided ? [] : [CHANGE], truncated: false });
    }
    return undefined;
  });
};

const decide = async (decision: 'Apply' | 'Reject', note: string | undefined) => {
  const server = serverWithOneChange();
  renderApp('/changes', server.fetch);
  const user = userEvent.setup();
  if (note !== undefined) await user.type(await screen.findByLabelText('Note (optional)'), note);
  await user.click(await screen.findByRole('button', { name: decision }));
  const dialog = await screen.findByRole('alertdialog');
  await user.click(within(dialog).getByRole('button', { name: decision }));
  await screen.findByText('No change waits for approval.');
  const posts = server.requests.filter(({ method }) => method === 'POST');
  expect(posts).toHaveLength(1);
  return posts[0];
};

describe('a consolidation change', () => {
  it('is rejected with its note, after the confirmation', async () => {
    const post = await decide('Reject', '  Not the same type. ');
    expect(post?.path).toBe(`/changes/${CHANGE.id}`);
    expect(post?.credentials).toBe('same-origin');
    expect(post?.body).toBe(JSON.stringify({ decision: 'reject', note: 'Not the same type.' }));
  });

  it('is applied without a note when none is written', async () => {
    const post = await decide('Apply', undefined);
    expect(post?.credentials).toBe('same-origin');
    expect(post?.body).toBe(JSON.stringify({ decision: 'apply' }));
  });

  it('is not decided when the confirmation is cancelled', async () => {
    const server = serverWithOneChange();
    renderApp('/changes', server.fetch);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Apply' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' }),
    );
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(server.requests.some(({ method }) => method === 'POST')).toBe(false);
  });
});
