import { setNonce } from 'get-nonce';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { AppProviders } from './app.tsx';
import './index.css';
import { cspNonce } from './lib/csp-nonce.ts';
import { BASENAME, ROUTES } from './routes.tsx';

// The scroll lock of Radix inserts its style elements with the nonce `get-nonce` holds.
const nonce = cspNonce();
if (nonce !== undefined) setNonce(nonce);

const root = document.getElementById('root');
if (root === null) throw new Error('The page has no #root element.');

const router = createBrowserRouter(ROUTES, { basename: BASENAME });

createRoot(root).render(
  <StrictMode>
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  </StrictMode>,
);
