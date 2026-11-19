import { useQuery } from '@tanstack/react-query';
import { unwrap } from '../../api/auth-result.ts';
import { type ApiKey, apiKeyListSchema } from '../../api/auth-schemas.ts';
import { useAuth } from '../../api/session.ts';
import { DataTable } from '../../components/data-table/data-table.tsx';
import { dataTableColumns } from '../../components/data-table/data-table-columns.ts';
import { ErrorAlert } from '../../components/error-alert.tsx';
import { PageHeader } from '../../components/page-header.tsx';
import { Skeleton } from '../../components/ui/skeleton.tsx';
import { formatTime } from '../../lib/format.ts';
import { ApiKeyBulkActions } from './api-key-bulk-actions.tsx';
import { API_KEYS_QUERY_KEY } from './api-keys-query.ts';
import { CreateApiKey } from './create-api-key.tsx';
import { DeleteApiKey } from './delete-api-key.tsx';

const shownTime = (date: Date | null): string =>
  date === null ? 'Never' : formatTime(date.toISOString());

const apiKeyName = (apiKey: ApiKey): string => apiKey.name ?? 'Unnamed key';

const column = dataTableColumns<ApiKey>();

const columns = column.columns([
  column.display({
    id: 'name',
    header: 'Name',
    meta: { className: 'font-medium' },
    cell: ({ row }) => apiKeyName(row.original),
  }),
  column.accessor('start', {
    header: 'Starts with',
    meta: { className: 'font-mono text-xs' },
    cell: ({ getValue }) => {
      const start = getValue();
      return start === null ? null : `${start}...`;
    },
  }),
  column.accessor('createdAt', {
    header: 'Created',
    cell: ({ getValue }) => shownTime(getValue()),
  }),
  column.accessor('expiresAt', {
    header: 'Expires',
    cell: ({ getValue }) => shownTime(getValue()),
  }),
  column.accessor('lastRequest', {
    header: 'Last used',
    cell: ({ getValue }) => shownTime(getValue()),
  }),
  column.display({
    id: 'actions',
    header: () => <span className="sr-only">Actions</span>,
    meta: { className: 'text-right' },
    cell: ({ row }) => <DeleteApiKey id={row.original.id} name={apiKeyName(row.original)} />,
  }),
]);

/** The API keys of the account: what the SDK and other programs authenticate with. */
export const ApiKeysPage = () => {
  const auth = useAuth();
  const keys = useQuery({
    queryKey: API_KEYS_QUERY_KEY,
    queryFn: async () => unwrap(apiKeyListSchema, await auth.apiKey.list()).apiKeys,
  });

  const body = (() => {
    if (keys.isPending) return <Skeleton className="h-24 w-full" />;
    if (keys.isError) return <ErrorAlert error={keys.error} title="API keys not loaded" />;
    if (keys.data.length === 0) {
      return <p className="text-sm text-muted-foreground">No API key yet.</p>;
    }
    return (
      <DataTable
        columns={columns}
        data={keys.data}
        getRowId={({ id }) => id}
        rowLabel={apiKeyName}
        bulkActions={ApiKeyBulkActions}
      />
    );
  })();

  return (
    <>
      <PageHeader
        title="API keys"
        description="A program calls the API of Liasse with one of these keys, as your account."
        actions={<CreateApiKey />}
      />
      {body}
    </>
  );
};
