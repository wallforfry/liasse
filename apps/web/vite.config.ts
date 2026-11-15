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
      ['/documents', '/search', '/types', '/changes', '/ui/session'].map((path) => [
        path,
        'http://127.0.0.1:8080',
      ]),
    ),
  },
});
