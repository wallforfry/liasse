import { SearchIcon, XIcon } from 'lucide-react';
import { type SubmitEvent, useState } from 'react';
import { Button } from '../../components/ui/button.tsx';
import { Input } from '../../components/ui/input.tsx';

export interface DocumentSearchBoxProps {
  readonly query: string | undefined;
  /** Undefined clears the search, back to the list. */
  readonly onSearch: (query: string | undefined) => void;
}

/** Its draft starts from `query`: give it `query` as its key to start again from a new one. */
export const DocumentSearchBox = ({ query, onSearch }: DocumentSearchBoxProps) => {
  const [draft, setDraft] = useState(query ?? '');
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = draft.trim();
    onSearch(trimmed === '' ? undefined : trimmed);
  };
  return (
    <form role="search" className="flex w-full max-w-xl items-center gap-2" onSubmit={submit}>
      <Input
        type="search"
        aria-label="Search the documents"
        placeholder="Full text and meaning, over every page"
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
        }}
      />
      <Button type="submit">
        <SearchIcon />
        Search
      </Button>
      {query === undefined ? null : (
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            onSearch(undefined);
          }}
        >
          <XIcon />
          Clear
        </Button>
      )}
    </form>
  );
};
