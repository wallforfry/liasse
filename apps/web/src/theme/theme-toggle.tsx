import { MoonIcon, SunIcon } from 'lucide-react';
import { Button } from '../components/ui/button.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu.tsx';
import { isTheme, type Theme, useTheme } from './theme.ts';

const LABELS: Readonly<Record<Theme, string>> = {
  light: 'Light',
  dark: 'Dark',
  system: 'System',
};

export const ThemeToggle = () => {
  const { theme, resolvedTheme, setTheme } = useTheme();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8">
          {resolvedTheme === 'dark' ? <MoonIcon /> : <SunIcon />}
          <span className="sr-only">Theme</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={theme}
          onValueChange={(value) => {
            if (isTheme(value)) setTheme(value);
          }}
        >
          {Object.entries(LABELS).map(([value, label]) => (
            <DropdownMenuRadioItem key={value} value={value}>
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
