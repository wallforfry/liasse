import { FolderArchiveIcon, LogOutIcon } from 'lucide-react';
import { Link, useLocation } from 'react-router';
import { toast } from 'sonner';
import { errorMessage } from '../api/errors.ts';
import { useSession } from '../api/session.ts';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '../components/ui/sidebar.tsx';
import { useSidebar } from '../components/ui/sidebar-context.ts';
import { ACCOUNT_NAVIGATION, NAVIGATION, type NavigationItem } from './navigation.ts';

interface NavigationGroupProps {
  readonly label: string;
  readonly items: readonly NavigationItem[];
  readonly pathname: string;
  readonly onNavigate: () => void;
}

const NavigationGroup = ({ label, items, pathname, onNavigate }: NavigationGroupProps) => (
  <SidebarGroup>
    <SidebarGroupLabel>{label}</SidebarGroupLabel>
    <SidebarMenu>
      {items.map(({ label: itemLabel, path, icon: Icon }) => (
        <SidebarMenuItem key={path}>
          <SidebarMenuButton asChild isActive={pathname.startsWith(path)} tooltip={itemLabel}>
            <Link to={path} onClick={onNavigate}>
              <Icon />
              <span>{itemLabel}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  </SidebarGroup>
);

export const AppSidebar = () => {
  const { pathname } = useLocation();
  const { logOut } = useSession();
  const { isMobile, setOpenMobile } = useSidebar();
  const closeOnMobile = () => {
    if (isMobile) setOpenMobile(false);
  };
  return (
    <Sidebar>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild className="h-12" tooltip="Liasse">
              <Link to="/documents" onClick={closeOnMobile}>
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
                  <FolderArchiveIcon className="size-4" />
                </span>
                <span className="font-semibold">Liasse</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavigationGroup
          label="Library"
          items={NAVIGATION}
          pathname={pathname}
          onNavigate={closeOnMobile}
        />
        <NavigationGroup
          label="Account"
          items={ACCOUNT_NAVIGATION}
          pathname={pathname}
          onNavigate={closeOnMobile}
        />
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Log out"
              onClick={() => {
                logOut().catch((error: unknown) => {
                  toast.error(errorMessage(error));
                });
              }}
            >
              <LogOutIcon />
              <span>Log out</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
};
