import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { CheckIcon, ChevronsUpDownIcon, XIcon } from 'lucide-react';
import { useState } from 'react';
import { errorMessage } from '../../api/errors.ts';
import { useClient } from '../../api/session.ts';
import { Button } from '../../components/ui/button.tsx';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '../../components/ui/command.tsx';
import { Label } from '../../components/ui/label.tsx';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover.tsx';
import { plural } from '../../lib/format.ts';
import { cn } from '../../lib/utils.ts';
import type { EntityFilter as Entity } from './list-params.ts';

const SHOWN_ENTITIES = 20;

export interface EntityFilterProps {
  readonly value: Entity | undefined;
  /** Undefined clears the filter. */
  readonly onChange: (entity: Entity | undefined) => void;
}

/** An entity searched by its name or an alias on the server, which ranks and filters. */
export const EntityFilter = ({ value, onChange }: EntityFilterProps) => {
  const client = useClient();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const query = search.trim();
  const options = { ...(query === '' ? {} : { query }), limit: SHOWN_ENTITIES };
  const entities = useQuery({
    queryKey: ['entities', options],
    queryFn: async () => client.listEntities(options),
    enabled: open,
    placeholderData: keepPreviousData,
  });
  const empty = entities.isPending
    ? 'Loading the entities...'
    : entities.isError
      ? errorMessage(entities.error)
      : 'No entity matches.';
  const choose = (entity: Entity | undefined) => {
    onChange(entity);
    setOpen(false);
  };
  return (
    <div className="grid gap-1.5">
      <Label htmlFor="filter-entity" className="text-xs text-muted-foreground">
        Entity
      </Label>
      <div className="flex items-center gap-1">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              id="filter-entity"
              type="button"
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className="w-56 justify-between font-normal"
            >
              <span className="truncate">{value?.name ?? 'Any entity'}</span>
              <ChevronsUpDownIcon className="opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-0" align="start">
            <Command shouldFilter={false}>
              <CommandInput
                placeholder="Search the entities..."
                value={search}
                onValueChange={setSearch}
              />
              <CommandList>
                <CommandEmpty>{empty}</CommandEmpty>
                <CommandGroup>
                  {(entities.data?.entities ?? []).map((entity) => (
                    <CommandItem
                      key={entity.id}
                      value={entity.id}
                      onSelect={() => {
                        choose({ id: entity.id, name: entity.canonical_name });
                      }}
                    >
                      <CheckIcon
                        className={cn(entity.id === value?.id ? 'opacity-100' : 'opacity-0')}
                      />
                      <span className="flex flex-col">
                        <span>{entity.canonical_name}</span>
                        <span className="text-xs text-muted-foreground">
                          {entity.kind}, {plural(entity.document_count, 'document')}
                        </span>
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        {value === undefined ? null : (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Clear the entity"
            onClick={() => {
              choose(undefined);
            }}
          >
            <XIcon />
          </Button>
        )}
      </div>
    </div>
  );
};
