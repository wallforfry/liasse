import type { McpConnection } from '@liasse/contract';
import { useQueryClient } from '@tanstack/react-query';
import { UnplugIcon } from 'lucide-react';
import { useAuth } from '../../api/session.ts';
import { BulkAction } from '../../components/data-table/bulk-action.tsx';
import type { BulkActionsProps } from '../../components/data-table/data-table.tsx';
import { plural } from '../../lib/format.ts';
import { MCP_CONNECTIONS_QUERY_KEY, revokeMcpConnection } from './mcp-connections-api.ts';

export const McpConnectionBulkActions = ({ rows, clear }: BulkActionsProps<McpConnection>) => {
  const auth = useAuth();
  const queryClient = useQueryClient();
  return (
    <BulkAction
      rows={rows}
      run={async ({ id }) => revokeMcpConnection(auth, id)}
      onSettled={async () => {
        clear();
        await queryClient.invalidateQueries({ queryKey: MCP_CONNECTIONS_QUERY_KEY });
      }}
      label="Revoke"
      icon={<UnplugIcon />}
      noun="MCP connection"
      done="revoked"
      confirmation={{
        destructive: true,
        title: `Revoke ${plural(rows.length, 'MCP connection')}?`,
        description:
          'These clients can no longer call Liasse: their tokens stop working now. Each can connect again only through a new authorization, which you would have to accept.',
      }}
    />
  );
};
