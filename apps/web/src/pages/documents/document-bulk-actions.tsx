import type { DocumentSummary } from '@liasse/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCheckIcon, RotateCwIcon, Trash2Icon } from 'lucide-react';
import { useClient } from '../../api/session.ts';
import { BulkAction } from '../../components/data-table/bulk-action.tsx';
import type { BulkActionsProps } from '../../components/data-table/data-table.tsx';
import { plural } from '../../lib/format.ts';
import { acceptReview } from '../document/accept-review.ts';

/**
 * What can be done to several documents of the list at once. An action that applies to
 * documents of one status only is offered while the selection holds one.
 */
export const DocumentBulkActions = ({ rows, clear }: BulkActionsProps<DocumentSummary>) => {
  const client = useClient();
  const queryClient = useQueryClient();
  const toReview = rows.filter(({ status }) => status === 'needs_review');
  const failed = rows.filter(({ status }) => status === 'failed');
  const refresh = async () => {
    clear();
    await queryClient.invalidateQueries({ queryKey: ['documents'] });
  };
  return (
    <>
      {toReview.length === 0 ? null : (
        <BulkAction
          rows={toReview}
          run={async ({ id }) => {
            await acceptReview(client, id);
            await queryClient.invalidateQueries({ queryKey: ['document', id] });
          }}
          onSettled={refresh}
          label="Accept as read"
          icon={<CheckCheckIcon />}
          noun="document"
          done="accepted"
          confirmation={{
            title: `Accept ${plural(toReview.length, 'document')} as read?`,
            description:
              'Each keeps its type, and every doubtful value is confirmed as it was read, without being looked at. A value that changed since is refused, and its document stays to review.',
          }}
        />
      )}
      {failed.length === 0 ? null : (
        <BulkAction
          rows={failed}
          run={async ({ id }) => {
            await client.retryDocument(id);
            await queryClient.invalidateQueries({ queryKey: ['document', id] });
          }}
          onSettled={refresh}
          label="Retry failed"
          icon={<RotateCwIcon />}
          noun="document"
          done="queued again"
        />
      )}
      <BulkAction
        rows={rows}
        run={async ({ id }) => {
          await client.deleteDocument(id);
          queryClient.removeQueries({ queryKey: ['document', id] });
        }}
        onSettled={refresh}
        label="Delete"
        icon={<Trash2Icon />}
        noun="document"
        done="deleted"
        confirmation={{
          destructive: true,
          title: `Delete ${plural(rows.length, 'document')}?`,
          description:
            'These documents and everything extracted from them are removed from Liasse. This cannot be undone.',
        }}
      />
    </>
  );
};
