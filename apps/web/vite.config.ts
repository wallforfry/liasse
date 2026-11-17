import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig } from 'vite';
import { sonnerStylesheet } from './sonner-stylesheet.ts';

export default defineConfig({
  base: '/ui/',
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
    proxy: Object.fromEntries(
      // `/api` holds the auth server. Node loads this file before any workspace package is
      // built, so it cannot import `AUTH_BASE_PATH` from the contract.
      ['/documents', '/search', '/types', '/changes', '/settings', '/api', '/.well-known'].map(
        (path) => [path, 'http://127.0.0.1:8080'],
      ),
    ),
  },
});
