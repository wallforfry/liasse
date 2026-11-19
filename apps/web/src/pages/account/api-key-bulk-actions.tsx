import { useQueryClient } from '@tanstack/react-query';
import { Trash2Icon } from 'lucide-react';
import type { ApiKey } from '../../api/auth-schemas.ts';
import { useAuth } from '../../api/session.ts';
import { BulkAction } from '../../components/data-table/bulk-action.tsx';
import type { BulkActionsProps } from '../../components/data-table/data-table.tsx';
import { plural } from '../../lib/format.ts';
import { API_KEYS_QUERY_KEY, deleteApiKey } from './api-keys-query.ts';

export const ApiKeyBulkActions = ({ rows, clear }: BulkActionsProps<ApiKey>) => {
  const auth = useAuth();
  const queryClient = useQueryClient();
  return (
    <BulkAction
      rows={rows}
      run={async ({ id }) => deleteApiKey(auth, id)}
      onSettled={async () => {
        clear();
        await queryClient.invalidateQueries({ queryKey: API_KEYS_QUERY_KEY });
      }}
      label="Delete"
      icon={<Trash2Icon />}
      noun="API key"
      done="deleted"
      confirmation={{
        title: `Delete ${plural(rows.length, 'API key')}?`,
        description:
          'The programs that use these keys can no longer call Liasse. This cannot be undone.',
      }}
    />
  );
};
