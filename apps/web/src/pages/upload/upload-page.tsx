import { useQueryClient } from '@tanstack/react-query';
import { UploadIcon } from 'lucide-react';
import { type SubmitEvent, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { ErrorAlert } from '../../components/error-alert.tsx';
import { PageHeader } from '../../components/page-header.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Card, CardContent } from '../../components/ui/card.tsx';
import { Checkbox } from '../../components/ui/checkbox.tsx';
import { Input } from '../../components/ui/input.tsx';
import { Label } from '../../components/ui/label.tsx';
import { documentPath } from '../../layout/navigation.ts';
import { UploadResults } from './upload-results.tsx';
import { type SettledOutcome, useUploadBatch } from './use-upload-batch.ts';

const plural = (count: number, noun: string): string =>
  `${String(count)} ${noun}${count === 1 ? '' : 's'}`;

const announce = (outcomes: readonly SettledOutcome[]): void => {
  const failed = outcomes.filter(({ status }) => status === 'failed').length;
  const uploaded = outcomes.length - failed;
  if (failed === 0) toast.success(`${plural(uploaded, 'file')} uploaded. They are processed.`);
  else if (uploaded === 0) toast.error(`${plural(failed, 'file')} not uploaded.`);
  else toast.warning(`${plural(uploaded, 'file')} uploaded, ${plural(failed, 'file')} not.`);
};

export const UploadPage = () => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [files, setFiles] = useState<readonly File[]>([]);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [hint, setHint] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);

  const { entries, mutation } = useUploadBatch(async (outcomes) => {
    await queryClient.invalidateQueries({ queryKey: ['documents'] });
    const [only] = outcomes;
    if (outcomes.length === 1 && only?.status === 'uploaded') {
      toast.success(
        only.result.duplicate
          ? 'This file was already in Liasse.'
          : 'Uploaded. The document is processed.',
      );
      await navigate(documentPath(only.result.id));
      return;
    }
    announce(outcomes);
    setFiles([]);
    setFileInputKey((key) => key + 1);
  });

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (files.length > 0) mutation.mutate({ files, hint, private: isPrivate });
  };

  return (
    <>
      <PageHeader
        title="Upload"
        description="PDF, images, DOCX or emails. Liasse reads, classifies and indexes them."
      />
      <Card className="max-w-xl">
        <CardContent className="flex flex-col gap-4">
          <form className="flex flex-col gap-4" onSubmit={submit}>
            {mutation.isError ? <ErrorAlert error={mutation.error} title="Not uploaded" /> : null}
            <div className="grid gap-2">
              <Label htmlFor="upload-files">Files</Label>
              <Input
                key={fileInputKey}
                id="upload-files"
                type="file"
                multiple
                disabled={mutation.isPending}
                onChange={(event) => {
                  setFiles(Array.from(event.target.files ?? []));
                }}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="upload-hint">Hint (optional)</Label>
              <Input
                id="upload-hint"
                placeholder="electricity bill"
                aria-describedby="upload-hint-scope"
                value={hint}
                onChange={(event) => {
                  setHint(event.target.value);
                }}
              />
              <p id="upload-hint-scope" className="text-muted-foreground text-sm">
                Given to every file of this upload.
              </p>
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
              <Button type="submit" disabled={files.length === 0 || mutation.isPending}>
                <UploadIcon />
                {mutation.isPending
                  ? 'Uploading...'
                  : files.length > 1
                    ? `Upload ${plural(files.length, 'file')}`
                    : 'Upload'}
              </Button>
            </div>
          </form>
          {entries.length > 0 ? <UploadResults entries={entries} /> : null}
        </CardContent>
      </Card>
    </>
  );
};
