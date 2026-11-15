import { useQuery } from '@tanstack/react-query';
import { unwrap } from '../../api/auth-result.ts';
import { type ApiKey, apiKeyListSchema } from '../../api/auth-schemas.ts';
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
import { API_KEYS_QUERY_KEY } from './api-keys-query.ts';
import { CreateApiKey } from './create-api-key.tsx';
import { DeleteApiKey } from './delete-api-key.tsx';

const shownTime = (date: Date | null): string =>
  date === null ? 'Never' : formatTime(date.toISOString());

const ApiKeyRow = ({ apiKey }: { readonly apiKey: ApiKey }) => {
  const name = apiKey.name ?? 'Unnamed key';
  return (
    <TableRow>
      <TableCell className="font-medium">{name}</TableCell>
      <TableCell className="font-mono text-xs">
        {apiKey.start === null ? null : `${apiKey.start}...`}
      </TableCell>
      <TableCell>{shownTime(apiKey.createdAt)}</TableCell>
      <TableCell>{shownTime(apiKey.expiresAt)}</TableCell>
      <TableCell>{shownTime(apiKey.lastRequest)}</TableCell>
      <TableCell className="text-right">
        <DeleteApiKey id={apiKey.id} name={name} />
      </TableCell>
    </TableRow>
  );
};

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
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Starts with</TableHead>
            <TableHead>Created</TableHead>
            <TableHead>Expires</TableHead>
            <TableHead>Last used</TableHead>
            <TableHead>
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {keys.data.map((apiKey) => (
            <ApiKeyRow key={apiKey.id} apiKey={apiKey} />
          ))}
        </TableBody>
      </Table>
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
