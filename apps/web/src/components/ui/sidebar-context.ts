import { createContext, useContext, useSyncExternalStore } from 'react';

export interface SidebarState {
  readonly state: 'expanded' | 'collapsed';
  readonly open: boolean;
  readonly setOpen: (open: boolean) => void;
  readonly openMobile: boolean;
  readonly setOpenMobile: (open: boolean) => void;
  readonly isMobile: boolean;
  readonly toggleSidebar: () => void;
}

export const SidebarContext = createContext<SidebarState | undefined>(undefined);

export const useSidebar = (): SidebarState => {
  const state = useContext(SidebarContext);
  if (state === undefined) throw new Error('useSidebar needs a SidebarProvider above it.');
  return state;
};

const MOBILE_QUERY = '(max-width: 767px)';

const subscribe = (onChange: () => void): (() => void) => {
  const query = window.matchMedia(MOBILE_QUERY);
  query.addEventListener('change', onChange);
  return () => {
    query.removeEventListener('change', onChange);
  };
};

export const useIsMobile = (): boolean =>
  useSyncExternalStore(subscribe, () => window.matchMedia(MOBILE_QUERY).matches);
