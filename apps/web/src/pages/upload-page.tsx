import { useMutation, useQueryClient } from '@tanstack/react-query';
import { UploadIcon } from 'lucide-react';
import { type SubmitEvent, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { useClient } from '../api/session.ts';
import { ErrorAlert } from '../components/error-alert.tsx';
import { PageHeader } from '../components/page-header.tsx';
import { Button } from '../components/ui/button.tsx';
import { Card, CardContent } from '../components/ui/card.tsx';
import { Checkbox } from '../components/ui/checkbox.tsx';
import { Input } from '../components/ui/input.tsx';
import { Label } from '../components/ui/label.tsx';
import { documentPath } from '../layout/navigation.ts';

export const UploadPage = () => {
  const client = useClient();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [file, setFile] = useState<File | undefined>(undefined);
  const [hint, setHint] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const upload = useMutation({
    mutationFn: async (chosen: File) =>
      client.uploadDocument({
        file: chosen,
        private: isPrivate,
        ...(hint.trim() === '' ? {} : { hint: hint.trim() }),
      }),
    onSuccess: async ({ id, duplicate }) => {
      toast.success(
        duplicate ? 'This file was already in Liasse.' : 'Uploaded. The document is processed.',
      );
      await queryClient.invalidateQueries({ queryKey: ['documents'] });
      await navigate(documentPath(id));
    },
  });

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (file !== undefined) upload.mutate(file);
  };

  return (
    <>
      <PageHeader
        title="Upload"
        description="PDF, images, DOCX or emails. Liasse reads, classifies and indexes them."
      />
      <Card className="max-w-xl">
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={submit}>
            {upload.isError ? <ErrorAlert error={upload.error} title="Not uploaded" /> : null}
            <div className="grid gap-2">
              <Label htmlFor="upload-file">File</Label>
              <Input
                id="upload-file"
                type="file"
                required
                onChange={(event) => {
                  setFile(event.target.files?.[0]);
                }}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="upload-hint">Hint (optional)</Label>
              <Input
                id="upload-hint"
                placeholder="electricity bill"
                value={hint}
                onChange={(event) => {
                  setHint(event.target.value);
                }}
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="upload-private"
                checked={isPrivate}
                onCheckedChange={(checked) => {
                  setIsPrivate(checked === true);
                }}
              />
              <Label htmlFor="upload-private">Private</Label>
            </div>
            <div>
              <Button type="submit" disabled={file === undefined || upload.isPending}>
                <UploadIcon />
                {upload.isPending ? 'Uploading...' : 'Upload'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </>
  );
};
