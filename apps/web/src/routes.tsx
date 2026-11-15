import { Navigate, type RouteObject } from 'react-router';
import { AppLayout } from './layout/app-layout.tsx';
import { RequireSession } from './layout/require-session.tsx';
import { ChangesPage } from './pages/changes/changes-page.tsx';
import { DocumentPage } from './pages/document/document-page.tsx';
import { DocumentListPage } from './pages/documents/document-list-page.tsx';
import { LoginPage } from './pages/login-page.tsx';
import { NotFoundPage } from './pages/not-found-page.tsx';
import { SearchPage } from './pages/search/search-page.tsx';
import { UploadPage } from './pages/upload-page.tsx';

/** Where the server serves the application. */
export const BASENAME = '/ui';

export const ROUTES: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
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
          { path: '/search', element: <SearchPage /> },
          { path: '/upload', element: <UploadPage /> },
          { path: '/changes', element: <ChangesPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
];
