import type { DocumentSummary } from '@liasse/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { RotateCwIcon, Trash2Icon } from 'lucide-react';
import { useClient } from '../../api/session.ts';
import { BulkAction } from '../../components/data-table/bulk-action.tsx';
import type { BulkActionsProps } from '../../components/data-table/data-table.tsx';
import { plural } from '../../lib/format.ts';

/** What can be done to several documents of the list at once. */
export const DocumentBulkActions = ({ rows, clear }: BulkActionsProps<DocumentSummary>) => {
  const client = useClient();
  const queryClient = useQueryClient();
  const failed = rows.filter(({ status }) => status === 'failed');
  return (
    <>
      <BulkAction
        rows={failed}
        run={async ({ id }) => client.retryDocument(id)}
        onSettled={async () => {
          clear();
          await queryClient.invalidateQueries({ queryKey: ['documents'] });
        }}
        label="Retry failed"
        icon={<RotateCwIcon />}
        noun="document"
        done="queued again"
      />
      <BulkAction
        rows={rows}
        run={async ({ id }) => {
          await client.deleteDocument(id);
          queryClient.removeQueries({ queryKey: ['document', id] });
        }}
        onSettled={async () => {
          clear();
          await queryClient.invalidateQueries({ queryKey: ['documents'] });
        }}
        label="Delete"
        icon={<Trash2Icon />}
        noun="document"
        done="deleted"
        confirmation={{
          title: `Delete ${plural(rows.length, 'document')}?`,
          description:
            'These documents and everything extracted from them are removed from Liasse. This cannot be undone.',
        }}
      />
    </>
  );
};
