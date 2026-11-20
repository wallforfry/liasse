import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig } from 'vite';
import { sonnerStylesheet } from './sonner-stylesheet.ts';

const UI_BASE = '/ui/';
const escapedForRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Vite serves the UI and its own paths (`@vite/client`, `@fs`, the HMR socket) under the base;
// every other path belongs to the server. A key that starts with `^` is a regular expression.
const SERVER_PATHS = `^(?!${escapedForRegExp(UI_BASE.slice(0, -1))}(?:[/?]|$))`;

export default defineConfig({
  base: UI_BASE,
  plugins: [react(), tailwindcss(), sonnerStylesheet()],
  // The workspace packages are read from their TypeScript sources, as the tests do.
  resolve: { conditions: ['@liasse/source', ...defaultClientConditions] },
  build: {
    // The polyfill is an inline script, which the policy of `/ui` refuses; every browser
    // the UI targets supports `modulepreload`.
    modulePreload: { polyfill: false },
    sourcemap: false,
  },
  server: {
    // `pnpm --filter @liasse/web dev` against a server started from source.
    proxy: { [SERVER_PATHS]: 'http://127.0.0.1:8080' },
  },
});
