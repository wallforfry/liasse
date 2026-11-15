import {
  FileTextIcon,
  GitPullRequestArrowIcon,
  InboxIcon,
  KeyRoundIcon,
  LockKeyholeIcon,
  type LucideIcon,
  PlugIcon,
  SearchIcon,
  UploadIcon,
} from 'lucide-react';

export interface NavigationItem {
  readonly label: string;
  /** Under the base `/ui` of the router. */
  readonly path: string;
  readonly icon: LucideIcon;
}

export const NAVIGATION: readonly NavigationItem[] = [
  { label: 'Documents', path: '/documents', icon: FileTextIcon },
  { label: 'Review', path: '/review', icon: InboxIcon },
  { label: 'Search', path: '/search', icon: SearchIcon },
  { label: 'Upload', path: '/upload', icon: UploadIcon },
  { label: 'Changes', path: '/changes', icon: GitPullRequestArrowIcon },
];

export const ACCOUNT_NAVIGATION: readonly NavigationItem[] = [
  { label: 'API keys', path: '/account/api-keys', icon: KeyRoundIcon },
  { label: 'MCP connections', path: '/account/mcp-connections', icon: PlugIcon },
  { label: 'Change password', path: '/account/password', icon: LockKeyholeIcon },
];

export const documentPath = (id: string): string => `/documents/${encodeURIComponent(id)}`;

/** The file route of the REST API, outside the router: the session cookie opens it. */
export const documentFilePath = (id: string): string => `/documents/${encodeURIComponent(id)}/file`;

export const searchPath = (query: string): string =>
  `/search?${new URLSearchParams({ q: query }).toString()}`;
