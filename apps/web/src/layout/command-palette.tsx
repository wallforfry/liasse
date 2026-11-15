import { MoonIcon, SearchIcon, SunIcon } from 'lucide-react';
import { type Dispatch, type SetStateAction, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '../components/ui/command.tsx';
import { useTheme } from '../theme/theme.ts';
import { NAVIGATION, searchPath } from './navigation.ts';

export interface CommandPaletteProps {
  readonly open: boolean;
  readonly setOpen: Dispatch<SetStateAction<boolean>>;
}

/** Cmd+K or Ctrl+K: go to a page, search the documents, switch the theme. */
export const CommandPalette = ({ open, setOpen }: CommandPaletteProps) => {
  const [query, setQuery] = useState('');
  const navigate = useNavigate();
  const { setTheme } = useTheme();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [setOpen]);

  const run = (action: () => void) => () => {
    setOpen(false);
    setQuery('');
    action();
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput
        placeholder="Go to a page or search..."
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>Nothing matches.</CommandEmpty>
        {query.trim() === '' ? null : (
          <CommandGroup heading="Search">
            <CommandItem
              value={`search ${query}`}
              onSelect={run(() => {
                void navigate(searchPath(query.trim()));
              })}
            >
              <SearchIcon />
              <span>Search the documents for {query.trim()}</span>
            </CommandItem>
          </CommandGroup>
        )}
        <CommandGroup heading="Pages">
          {NAVIGATION.map(({ label, path, icon: Icon }) => (
            <CommandItem
              key={path}
              value={label}
              onSelect={run(() => {
                void navigate(path);
              })}
            >
              <Icon />
              <span>{label}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Theme">
          <CommandItem
            value="Light theme"
            onSelect={run(() => {
              setTheme('light');
            })}
          >
            <SunIcon />
            <span>Light theme</span>
          </CommandItem>
          <CommandItem
            value="Dark theme"
            onSelect={run(() => {
              setTheme('dark');
            })}
          >
            <MoonIcon />
            <span>Dark theme</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
};
