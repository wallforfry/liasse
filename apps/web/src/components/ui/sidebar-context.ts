import { createContext, useContext } from 'react';
import { useMediaQuery } from '../../lib/use-media-query.ts';

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

export const useIsMobile = (): boolean => useMediaQuery(MOBILE_QUERY);
