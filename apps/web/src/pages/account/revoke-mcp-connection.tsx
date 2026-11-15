import { useMutation, useQueryClient } from '@tanstack/react-query';
import { UnplugIcon } from 'lucide-react';
import { toast } from 'sonner';
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
import { MCP_CONNECTIONS_QUERY_KEY, revokeMcpConnection } from './mcp-connections-api.ts';

export const RevokeMcpConnection = ({
  id,
  name,
}: {
  readonly id: string;
  readonly name: string;
}) => {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const revoke = useMutation({
    mutationFn: async () => revokeMcpConnection(auth, id),
    onSuccess: async () => {
      toast.success('The MCP connection was revoked.');
      await queryClient.invalidateQueries({ queryKey: MCP_CONNECTIONS_QUERY_KEY });
    },
    onError: (error) => {
      toast.error(errorMessage(error));
    },
  });
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="sm" disabled={revoke.isPending} aria-label={`Revoke ${name}`}>
          <UnplugIcon />
          Revoke
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Revoke this MCP connection?</AlertDialogTitle>
          <AlertDialogDescription>
            {name} can no longer call Liasse: its tokens stop working now. It can connect again only
            through a new authorization, which you would have to accept.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              revoke.mutate();
            }}
          >
            Revoke
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
