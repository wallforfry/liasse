import { useQuery } from '@tanstack/react-query';
import { ArrowLeftIcon } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { useClient } from '../../api/session.ts';
import { PrivateBadge, StatusBadge } from '../../components/document-badges.tsx';
import { ErrorAlert } from '../../components/error-alert.tsx';
import { PageHeader } from '../../components/page-header.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.tsx';
import { Skeleton } from '../../components/ui/skeleton.tsx';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs.tsx';
import { pollWhileProcessing } from '../../lib/processing.ts';
import { CorrectionForm } from './correction-form.tsx';
import { DeleteDocument } from './delete-document.tsx';
import { DocumentDetails, DocumentText, OriginalFile, ValueTable } from './document-parts.tsx';
import { RetryDocument } from './retry-document.tsx';

export const DocumentPage = () => {
  const client = useClient();
  const { id = '' } = useParams();
  const document = useQuery({
    queryKey: ['document', id],
    queryFn: async () => client.getDocument(id, { include: ['fields', 'text'] }),
    refetchInterval: (query) =>
      pollWhileProcessing(query.state.data === undefined ? undefined : [query.state.data]),
  });

  if (document.isPending) return <Skeleton className="h-96 w-full" />;
  if (document.isError) {
    return <ErrorAlert error={document.error} title="The document could not be read" />;
  }
  const view = document.data;
  const name = view.title ?? view.original_name;
  return (
    <>
      <div>
        <Button variant="ghost" size="sm" asChild className="-ml-2">
          <Link to="/documents">
            <ArrowLeftIcon />
            Documents
          </Link>
        </Button>
      </div>
      <PageHeader
        title={name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={view.status} />
            {view.private ? <PrivateBadge /> : null}
            <span>{view.type ?? 'untyped'}</span>
          </span>
        }
        actions={
          <>
            {view.status === 'failed' ? <RetryDocument id={view.id} /> : null}
            <DeleteDocument id={view.id} name={name} />
          </>
        }
      />
      {view.summary === null ? null : <p className="text-sm leading-relaxed">{view.summary}</p>}
      <Tabs defaultValue="details">
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="text">Text</TabsTrigger>
          <TabsTrigger value="file">File</TabsTrigger>
          <TabsTrigger value="correct">Correct</TabsTrigger>
        </TabsList>
        <TabsContent value="details" className="grid gap-4 lg:grid-cols-2">
          <Card className="lg:col-span-2">
            <CardContent>
              <DocumentDetails document={view} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Core values</CardTitle>
            </CardHeader>
            <CardContent>
              <ValueTable values={view.core} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Fields</CardTitle>
            </CardHeader>
            <CardContent>
              <ValueTable values={view.fields ?? {}} />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="text">
          <DocumentText text={view.text} />
        </TabsContent>
        <TabsContent value="file">
          <OriginalFile document={view} />
        </TabsContent>
        <TabsContent value="correct">
          <CorrectionForm key={view.updated_at} document={view} />
        </TabsContent>
      </Tabs>
    </>
  );
};
