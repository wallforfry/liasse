import { createContext, useContext } from 'react';

export const THEMES = ['light', 'dark', 'system'] as const;
export type Theme = (typeof THEMES)[number];
export type ResolvedTheme = Exclude<Theme, 'system'>;

export interface ThemeState {
  readonly theme: Theme;
  /** What `system` stands for at the moment. */
  readonly resolvedTheme: ResolvedTheme;
  readonly setTheme: (theme: Theme) => void;
}

export const ThemeContext = createContext<ThemeState | undefined>(undefined);

export const useTheme = (): ThemeState => {
  const state = useContext(ThemeContext);
  if (state === undefined) throw new Error('useTheme needs a ThemeProvider above it.');
  return state;
};

export const isTheme = (value: unknown): value is Theme => THEMES.some((theme) => theme === value);
