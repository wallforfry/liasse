import { useQuery } from '@tanstack/react-query';
import { CheckIcon, ChevronsUpDownIcon } from 'lucide-react';
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
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover.tsx';
import { cn } from '../../lib/utils.ts';

interface TypePickerProps {
  readonly id: string;
  readonly value: string;
  readonly onChange: (slug: string) => void;
}

/** A type of the registry, searched by slug, alias or description. */
export const TypePicker = ({ id, value, onChange }: TypePickerProps) => {
  const client = useClient();
  const [open, setOpen] = useState(false);
  // Without a status, the list holds every type a correction can name: merged ones are left out.
  const types = useQuery({ queryKey: ['types'], queryFn: async () => client.listTypes() });
  const listed = types.data?.types ?? [];
  const empty = types.isPending
    ? 'Loading the types...'
    : types.isError
      ? errorMessage(types.error)
      : 'No type matches.';
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="justify-between font-normal"
        >
          {value === '' ? <span className="text-muted-foreground">Choose a type</span> : value}
          <ChevronsUpDownIcon className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command>
          <CommandInput placeholder="Search the types..." />
          <CommandList>
            <CommandEmpty>{empty}</CommandEmpty>
            <CommandGroup>
              {listed.map((type) => (
                <CommandItem
                  key={type.slug}
                  value={type.slug}
                  keywords={[...type.aliases, type.description]}
                  onSelect={(slug) => {
                    onChange(slug);
                    setOpen(false);
                  }}
                >
                  <CheckIcon className={cn(type.slug === value ? 'opacity-100' : 'opacity-0')} />
                  <span className="flex flex-col">
                    <span>{type.slug}</span>
                    {type.description === '' ? null : (
                      <span className="text-xs text-muted-foreground">{type.description}</span>
                    )}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};
