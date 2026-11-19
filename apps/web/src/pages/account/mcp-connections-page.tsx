import type { McpConnection } from '@liasse/contract';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../api/session.ts';
import { DataTable } from '../../components/data-table/data-table.tsx';
import { dataTableColumns } from '../../components/data-table/data-table-columns.ts';
import { ErrorAlert } from '../../components/error-alert.tsx';
import { PageHeader } from '../../components/page-header.tsx';
import { Skeleton } from '../../components/ui/skeleton.tsx';
import { formatTime } from '../../lib/format.ts';
import { McpConnectionBulkActions } from './mcp-connection-bulk-actions.tsx';
import { listMcpConnections, MCP_CONNECTIONS_QUERY_KEY } from './mcp-connections-api.ts';
import { RevokeMcpConnection } from './revoke-mcp-connection.tsx';

const connectionName = (connection: McpConnection): string =>
  connection.name ?? connection.client_id;

const column = dataTableColumns<McpConnection>();

const columns = column.columns([
  column.display({
    id: 'name',
    header: 'Name',
    meta: { className: 'font-medium' },
    cell: ({ row }) => connectionName(row.original),
  }),
  column.accessor('client_id', {
    header: 'Client id',
    meta: { className: 'max-w-64 font-mono text-xs break-all whitespace-normal' },
  }),
  column.accessor('redirect_uris', {
    header: 'Redirect URIs',
    meta: { className: 'max-w-64 text-xs break-all whitespace-normal' },
    cell: ({ getValue }) => getValue().join(', '),
  }),
  column.accessor('granted_scopes', {
    header: 'Scopes',
    meta: { className: 'text-xs' },
    cell: ({ getValue }) => {
      const scopes = getValue();
      return scopes.length === 0 ? 'None' : scopes.join(' ');
    },
  }),
  column.accessor('active_tokens', { header: 'Active tokens' }),
  column.accessor('created_at', {
    header: 'Connected',
    cell: ({ getValue }) => {
      const created = getValue();
      return created === null ? 'Unknown' : formatTime(created);
    },
  }),
  column.accessor('last_token_issued_at', {
    header: 'Last token',
    cell: ({ getValue }) => {
      const issued = getValue();
      return issued === null ? 'Never' : formatTime(issued);
    },
  }),
  column.display({
    id: 'actions',
    header: () => <span className="sr-only">Actions</span>,
    meta: { className: 'text-right' },
    cell: ({ row }) => (
      <RevokeMcpConnection id={row.original.id} name={connectionName(row.original)} />
    ),
  }),
]);

/** The MCP clients connected to the account through OAuth, each with what it was granted. */
export const McpConnectionsPage = () => {
  const auth = useAuth();
  const connections = useQuery({
    queryKey: MCP_CONNECTIONS_QUERY_KEY,
    queryFn: async () => listMcpConnections(auth),
  });

  const body = (() => {
    if (connections.isPending) return <Skeleton className="h-24 w-full" />;
    if (connections.isError) {
      return <ErrorAlert error={connections.error} title="MCP connections not loaded" />;
    }
    if (connections.data.length === 0) {
      return <p className="text-sm text-muted-foreground">No MCP client is connected.</p>;
    }
    return (
      <DataTable
        columns={columns}
        data={connections.data}
        getRowId={({ id }) => id}
        rowLabel={connectionName}
        bulkActions={McpConnectionBulkActions}
      />
    );
  })();

  return (
    <>
      <PageHeader
        title="MCP connections"
        description="The MCP clients you authorized through OAuth. The name is what a client says of itself."
      />
      {body}
    </>
  );
};
