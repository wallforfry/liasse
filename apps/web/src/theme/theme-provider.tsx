import { type ReactNode, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { isTheme, type ResolvedTheme, type Theme, ThemeContext } from './theme.ts';

const STORAGE_KEY = 'liasse-theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

// Storage can be unavailable (a private window, a blocked origin): the theme then lasts
// as long as the page.
const storedTheme = (): Theme => {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return isTheme(value) ? value : 'system';
  } catch {
    return 'system';
  }
};

const storeTheme = (theme: Theme): void => {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Kept for this page only.
  }
};

const subscribeToSystem = (onChange: () => void): (() => void) => {
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener('change', onChange);
  return () => {
    query.removeEventListener('change', onChange);
  };
};

const systemTheme = (): ResolvedTheme => (window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light');

/** Light, dark or the theme of the system, kept in `localStorage` and set on `<html>`. */
export const ThemeProvider = ({ children }: { readonly children: ReactNode }) => {
  const [theme, setThemeState] = useState<Theme>(storedTheme);
  const system = useSyncExternalStore(subscribeToSystem, systemTheme);
  const resolvedTheme = theme === 'system' ? system : theme;

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolvedTheme === 'dark');
    document.documentElement.style.colorScheme = resolvedTheme;
  }, [resolvedTheme]);

  const state = useMemo(
    () => ({
      theme,
      resolvedTheme,
      setTheme: (next: Theme) => {
        storeTheme(next);
        setThemeState(next);
      },
    }),
    [theme, resolvedTheme],
  );
  return <ThemeContext value={state}>{children}</ThemeContext>;
};
