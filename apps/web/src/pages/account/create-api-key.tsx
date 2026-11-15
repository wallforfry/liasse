import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CopyIcon, PlusIcon } from 'lucide-react';
import { type SubmitEvent, useState } from 'react';
import { toast } from 'sonner';
import { unwrap } from '../../api/auth-result.ts';
import { createdApiKeySchema } from '../../api/auth-schemas.ts';
import { errorMessage } from '../../api/errors.ts';
import { useAuth } from '../../api/session.ts';
import { ErrorAlert } from '../../components/error-alert.tsx';
import { Button } from '../../components/ui/button.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../../components/ui/dialog.tsx';
import { Input } from '../../components/ui/input.tsx';
import { Label } from '../../components/ui/label.tsx';
import { API_KEYS_QUERY_KEY } from './api-keys-query.ts';

const CreatedKey = ({ apiKey }: { readonly apiKey: string }) => (
  <>
    <DialogHeader>
      <DialogTitle>API key created</DialogTitle>
      <DialogDescription>
        Copy it now and keep it somewhere safe: it will not be shown again.
      </DialogDescription>
    </DialogHeader>
    <div className="flex items-center gap-2">
      <Input readOnly aria-label="API key" className="font-mono text-xs" value={apiKey} />
      <Button
        variant="outline"
        size="icon"
        aria-label="Copy the API key"
        onClick={() => {
          navigator.clipboard.writeText(apiKey).then(
            () => toast.success('The API key was copied.'),
            (error: unknown) => toast.error(errorMessage(error)),
          );
        }}
      >
        <CopyIcon />
      </Button>
    </div>
  </>
);

/** Creates an API key and shows it, once: the server keeps only its hash. */
export const CreateApiKey = () => {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const create = useMutation({
    mutationFn: async (keyName: string) =>
      unwrap(createdApiKeySchema, await auth.apiKey.create({ name: keyName })).key,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: API_KEYS_QUERY_KEY });
    },
  });

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    create.mutate(name.trim());
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Closing forgets the key: nothing keeps it once the dialog is gone.
        if (!next) {
          setName('');
          create.reset();
        }
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <PlusIcon />
          Create API key
        </Button>
      </DialogTrigger>
      <DialogContent>
        {create.data === undefined ? (
          <form className="flex flex-col gap-4" onSubmit={submit}>
            <DialogHeader>
              <DialogTitle>Create an API key</DialogTitle>
              <DialogDescription>
                Name it after the program that will use it, to recognise it later.
              </DialogDescription>
            </DialogHeader>
            {create.error === null ? null : (
              <ErrorAlert error={create.error} title="API key not created" />
            )}
            <div className="grid gap-2">
              <Label htmlFor="api-key-name">Name</Label>
              <Input
                id="api-key-name"
                required
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                }}
              />
            </div>
            <Button
              type="submit"
              className="self-end"
              disabled={create.isPending || name.trim() === ''}
            >
              {create.isPending ? 'Creating...' : 'Create'}
            </Button>
          </form>
        ) : (
          <CreatedKey apiKey={create.data} />
        )}
      </DialogContent>
    </Dialog>
  );
};
