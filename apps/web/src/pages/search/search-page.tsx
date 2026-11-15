import { useQuery } from '@tanstack/react-query';
import { SearchIcon } from 'lucide-react';
import { type SubmitEvent, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useClient } from '../../api/session.ts';
import { ErrorAlert } from '../../components/error-alert.tsx';
import { PageHeader } from '../../components/page-header.tsx';
import { Badge } from '../../components/ui/badge.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.tsx';
import { Checkbox } from '../../components/ui/checkbox.tsx';
import { Input } from '../../components/ui/input.tsx';
import { Label } from '../../components/ui/label.tsx';
import { Skeleton } from '../../components/ui/skeleton.tsx';
import { documentPath } from '../../layout/navigation.ts';
import { Highlighted } from './highlighted.tsx';

interface SearchViewProps {
  readonly params: URLSearchParams;
  readonly setParams: ReturnType<typeof useSearchParams>[1];
}

const SearchView = ({ params, setParams }: SearchViewProps) => {
  const client = useClient();
  const query = params.get('q')?.trim() ?? '';
  const includePrivate = params.get('private') === 'true';
  const [draft, setDraft] = useState(query);
  const [draftPrivate, setDraftPrivate] = useState(includePrivate);
  const search = useQuery({
    queryKey: ['search', query, includePrivate],
    queryFn: async () => client.search({ query, include_private: includePrivate }),
    enabled: query !== '',
  });

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setParams({ q: draft.trim(), ...(draftPrivate ? { private: 'true' } : {}) });
  };

  return (
    <>
      <PageHeader title="Search" description="Full text and meaning, over every page." />
      <form className="flex flex-wrap items-center gap-3" onSubmit={submit}>
        <Input
          aria-label="Query"
          className="max-w-md"
          placeholder="electricity bill 2026"
          value={draft}
          required
          onChange={(event) => {
            setDraft(event.target.value);
          }}
        />
        <div className="flex items-center gap-2">
          <Checkbox
            id="search-private"
            checked={draftPrivate}
            onCheckedChange={(checked) => {
              setDraftPrivate(checked === true);
            }}
          />
          <Label htmlFor="search-private">Include private documents</Label>
        </div>
        <Button type="submit">
          <SearchIcon />
          Search
        </Button>
      </form>
      {search.isError ? <ErrorAlert error={search.error} title="The search failed" /> : null}
      {query !== '' && search.isPending ? <Skeleton className="h-40 w-full" /> : null}
      {search.data === undefined ? null : search.data.results.length === 0 ? (
        <p className="text-sm text-muted-foreground">No document matches.</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {search.data.results.map((result) => (
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
    </>
  );
};

// A new address, such as a search from the command palette, starts the form again from it.
export const SearchPage = () => {
  const [params, setParams] = useSearchParams();
  return <SearchView key={params.toString()} params={params} setParams={setParams} />;
};
