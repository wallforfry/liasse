import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2Icon } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';
import { unwrap } from '../../api/auth-result.ts';
import { errorMessage } from '../../api/errors.ts';
import { useAuth } from '../../api/session.ts';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '../../components/ui/alert-dialog.tsx';
import { Button } from '../../components/ui/button.tsx';
import { API_KEYS_QUERY_KEY } from './api-keys-query.ts';

export const DeleteApiKey = ({ id, name }: { readonly id: string; readonly name: string }) => {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: async () =>
      unwrap(z.object({ success: z.literal(true) }), await auth.apiKey.delete({ keyId: id })),
    onSuccess: async () => {
      toast.success('The API key was deleted.');
      await queryClient.invalidateQueries({ queryKey: API_KEYS_QUERY_KEY });
    },
    onError: (error) => {
      toast.error(errorMessage(error));
    },
  });
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="sm" disabled={remove.isPending} aria-label={`Delete ${name}`}>
          <Trash2Icon />
          Delete
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this API key?</AlertDialogTitle>
          <AlertDialogDescription>
            The programs that use {name} can no longer call Liasse. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              remove.mutate();
            }}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
