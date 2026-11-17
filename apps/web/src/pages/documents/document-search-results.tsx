import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { useClient } from '../../api/session.ts';
import { ErrorAlert } from '../../components/error-alert.tsx';
import { Badge } from '../../components/ui/badge.tsx';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.tsx';
import { Skeleton } from '../../components/ui/skeleton.tsx';
import { documentPath } from '../../layout/navigation.ts';
import { plural } from '../../lib/format.ts';
import { cn } from '../../lib/utils.ts';
import { Highlighted } from './highlighted.tsx';
import { type ListFilters, searchRequest } from './list-params.ts';

export interface DocumentSearchResultsProps {
  readonly query: string;
  readonly filters: ListFilters;
}

// Titles, types and snippets come from documents: they are rendered as text only.
export const DocumentSearchResults = ({ query, filters }: DocumentSearchResultsProps) => {
  const client = useClient();
  const request = searchRequest(query, filters);
  const search = useQuery({
    queryKey: ['search', request],
    queryFn: async () => client.search(request),
    placeholderData: keepPreviousData,
  });

  if (search.isError) return <ErrorAlert error={search.error} title="The search failed" />;
  if (search.data === undefined) return <Skeleton className="h-40 w-full" />;
  const { results } = search.data;
  // The results of the previous search, shown until those of this one arrive.
  const stale = search.isPlaceholderData;
  return (
    <div
      aria-busy={stale}
      className={cn('flex flex-col gap-6 transition-opacity', stale && 'opacity-50')}
    >
      <p className="text-sm text-muted-foreground">
        {plural(results.length, 'result')}, most relevant first
      </p>
      {results.length === 0 ? (
        <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          No document matches.
        </p>
      ) : (
        <ol className="flex flex-col gap-3">
          {results.map((result) => (
            <li key={result.id}>
              <Card className="gap-3 py-4">
                <CardHeader className="px-4">
                  <CardTitle className="flex flex-wrap items-center gap-2">
                    <Link
                      to={documentPath(result.id)}
                      className="underline-offset-4 hover:underline"
                    >
                      {result.title ?? result.id}
                    </Link>
                    <Badge variant="secondary">{result.type ?? 'untyped'}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-2 px-4 text-sm">
                  {result.snippets.map((snippet) => (
                    <p key={`${String(snippet.page_from)}-${snippet.text}`}>
                      <Highlighted snippet={snippet} />{' '}
                      <span className="text-muted-foreground">
                        (page {String(snippet.page_from)})
                      </span>
                    </p>
                  ))}
                </CardContent>
              </Card>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
};
