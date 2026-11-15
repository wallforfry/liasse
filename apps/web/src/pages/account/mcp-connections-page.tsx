import type { McpConnection } from '@liasse/contract';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../api/session.ts';
import { ErrorAlert } from '../../components/error-alert.tsx';
import { PageHeader } from '../../components/page-header.tsx';
import { Skeleton } from '../../components/ui/skeleton.tsx';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table.tsx';
import { formatTime } from '../../lib/format.ts';
import { listMcpConnections, MCP_CONNECTIONS_QUERY_KEY } from './mcp-connections-api.ts';
import { RevokeMcpConnection } from './revoke-mcp-connection.tsx';

const ConnectionRow = ({ connection }: { readonly connection: McpConnection }) => {
  const name = connection.name ?? connection.client_id;
  return (
    <TableRow>
      <TableCell className="font-medium">{name}</TableCell>
      <TableCell className="max-w-64 font-mono text-xs break-all whitespace-normal">
        {connection.client_id}
      </TableCell>
      <TableCell className="max-w-64 text-xs break-all whitespace-normal">
        {connection.redirect_uris.join(', ')}
      </TableCell>
      <TableCell className="text-xs">
        {connection.granted_scopes.length === 0 ? 'None' : connection.granted_scopes.join(' ')}
      </TableCell>
      <TableCell>{connection.active_tokens}</TableCell>
      <TableCell>
        {connection.created_at === null ? 'Unknown' : formatTime(connection.created_at)}
      </TableCell>
      <TableCell>
        {connection.last_token_issued_at === null
          ? 'Never'
          : formatTime(connection.last_token_issued_at)}
      </TableCell>
      <TableCell className="text-right">
        <RevokeMcpConnection id={connection.id} name={name} />
      </TableCell>
    </TableRow>
  );
};

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
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Client id</TableHead>
            <TableHead>Redirect URIs</TableHead>
            <TableHead>Scopes</TableHead>
            <TableHead>Active tokens</TableHead>
            <TableHead>Connected</TableHead>
            <TableHead>Last token</TableHead>
            <TableHead>
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {connections.data.map((connection) => (
            <ConnectionRow key={connection.id} connection={connection} />
          ))}
        </TableBody>
      </Table>
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
