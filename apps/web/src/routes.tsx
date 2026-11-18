import { Navigate, type RouteObject } from 'react-router';
import { AppLayout } from './layout/app-layout.tsx';
import { GOOGLE_CONSENT_PATH } from './layout/navigation.ts';
import { RequireSession } from './layout/require-session.tsx';
import { SetupGate } from './layout/setup-gate.tsx';
import { ApiKeysPage } from './pages/account/api-keys-page.tsx';
import { McpConnectionsPage } from './pages/account/mcp-connections-page.tsx';
import { ChangePasswordPage } from './pages/account/change-password-page.tsx';
import { ChangesPage } from './pages/changes/changes-page.tsx';
import { ConsentPage } from './pages/consent-page.tsx';
import { DocumentPage } from './pages/document/document-page.tsx';
import { DocumentListPage } from './pages/documents/document-list-page.tsx';
import { GraphPage } from './pages/graph/graph-page.tsx';
import { LoginPage } from './pages/login-page.tsx';
import { NotFoundPage } from './pages/not-found-page.tsx';
import { SettingsPage } from './pages/settings/settings-page.tsx';
import { GoogleConsentPage } from './pages/sources/google-consent-page.tsx';
import { EditSourcePage, NewSourcePage } from './pages/sources/source-editor-page.tsx';
import { SourcesPage } from './pages/sources/sources-page.tsx';
import { TypePage } from './pages/types/type-page.tsx';
import { TypesPage } from './pages/types/types-page.tsx';
import { UploadPage } from './pages/upload/upload-page.tsx';

/** Where the server serves the application. */
export const BASENAME = '/ui';

// The pages of an application that has an account: before the first one, the onboarding.
const APPLICATION_ROUTES: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  {
    element: <RequireSession keepQuery />,
    children: [{ path: '/consent', element: <ConsentPage /> }],
  },
  {
    element: <RequireSession />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <Navigate to="/documents" replace /> },
          {
            path: '/documents',
            element: (
              <DocumentListPage
                key="documents"
                title="Documents"
                description="Most recent first."
              />
            ),
          },
          { path: '/documents/:id', element: <DocumentPage /> },
          {
            path: '/review',
            element: (
              <DocumentListPage
                key="review"
                title="Review queue"
                description="Documents extraction was not sure about. Correct them to settle them."
                status="needs_review"
              />
            ),
          },
          { path: '/upload', element: <UploadPage /> },
          { path: '/sources', element: <SourcesPage /> },
          { path: '/sources/new', element: <NewSourcePage /> },
          { path: GOOGLE_CONSENT_PATH, element: <GoogleConsentPage /> },
          { path: '/sources/:id/edit', element: <EditSourcePage /> },
          { path: '/types', element: <TypesPage /> },
          { path: '/types/:slug', element: <TypePage /> },
          { path: '/graph', element: <GraphPage /> },
          { path: '/changes', element: <ChangesPage /> },
          { path: '/account/api-keys', element: <ApiKeysPage /> },
          { path: '/account/mcp-connections', element: <McpConnectionsPage /> },
          { path: '/account/password', element: <ChangePasswordPage /> },
          { path: '/account/settings', element: <SettingsPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
];

export const ROUTES: RouteObject[] = [{ element: <SetupGate />, children: APPLICATION_ROUTES }];
