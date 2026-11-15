import { PanelLeftIcon } from 'lucide-react';
import { Slot } from 'radix-ui';
import {
  type ComponentProps,
  type CSSProperties,
  type MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { cn } from '../../lib/utils.ts';
import { Button } from './button.tsx';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './sheet.tsx';
import { SidebarContext, useIsMobile, useSidebar } from './sidebar-context.ts';
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip.tsx';

// The parts of the shadcn sidebar this application uses: a sidebar that collapses to its
// icons on wide screens and opens as a sheet on narrow ones.

const SIDEBAR_KEYBOARD_SHORTCUT = 'b';

// Custom properties set through the style property, which the policy of `/ui` allows.
const SIDEBAR_WIDTHS: CSSProperties & Readonly<Record<`--${string}`, string>> = {
  '--sidebar-width': '16rem',
  '--sidebar-width-mobile': '18rem',
  '--sidebar-width-icon': '3rem',
};

export const SidebarProvider = ({ className, children, ...props }: ComponentProps<'div'>) => {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(true);
  const [openMobile, setOpenMobile] = useState(false);
  const toggleSidebar = useCallback(() => {
    if (isMobile) setOpenMobile((value) => !value);
    else setOpen((value) => !value);
  }, [isMobile]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === SIDEBAR_KEYBOARD_SHORTCUT && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [toggleSidebar]);

  const state = useMemo(
    () => ({
      state: open ? ('expanded' as const) : ('collapsed' as const),
      open,
      setOpen,
      isMobile,
      openMobile,
      setOpenMobile,
      toggleSidebar,
    }),
    [open, isMobile, openMobile, toggleSidebar],
  );

  return (
    <SidebarContext value={state}>
      <div
        data-slot="sidebar-wrapper"
        style={SIDEBAR_WIDTHS}
        className={cn('group/sidebar-wrapper flex min-h-svh w-full', className)}
        {...props}
      >
        {children}
      </div>
    </SidebarContext>
  );
};

export const Sidebar = ({ className, children, ...props }: ComponentProps<'div'>) => {
  const { isMobile, state, openMobile, setOpenMobile } = useSidebar();
  if (isMobile) {
    return (
      <Sheet open={openMobile} onOpenChange={setOpenMobile}>
        <SheetContent
          data-sidebar="sidebar"
          data-slot="sidebar"
          data-mobile="true"
          className="w-(--sidebar-width-mobile) bg-sidebar p-0 text-sidebar-foreground [&>button]:hidden"
          side="left"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Navigation</SheetTitle>
            <SheetDescription>The pages of Liasse.</SheetDescription>
          </SheetHeader>
          <div className="flex h-full w-full flex-col">{children}</div>
        </SheetContent>
      </Sheet>
    );
  }
  return (
    <div
      className="group peer hidden text-sidebar-foreground md:block"
      data-state={state}
      data-collapsible={state === 'collapsed' ? 'icon' : ''}
      data-slot="sidebar"
    >
      <div
        data-slot="sidebar-gap"
        className="relative w-(--sidebar-width) bg-transparent transition-[width] duration-200 ease-linear group-data-[collapsible=icon]:w-(--sidebar-width-icon)"
      />
      <div
        data-slot="sidebar-container"
        className={cn(
          'fixed inset-y-0 left-0 z-10 hidden h-svh w-(--sidebar-width) border-r transition-[left,right,width] duration-200 ease-linear group-data-[collapsible=icon]:w-(--sidebar-width-icon) md:flex',
          className,
        )}
        {...props}
      >
        <div
          data-sidebar="sidebar"
          data-slot="sidebar-inner"
          className="flex h-full w-full flex-col bg-sidebar"
        >
          {children}
        </div>
      </div>
    </div>
  );
};

export const SidebarTrigger = ({ className, onClick, ...props }: ComponentProps<typeof Button>) => {
  const { toggleSidebar } = useSidebar();
  return (
    <Button
      data-sidebar="trigger"
      data-slot="sidebar-trigger"
      variant="ghost"
      size="icon"
      className={cn('size-7', className)}
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        onClick?.(event);
        toggleSidebar();
      }}
      {...props}
    >
      <PanelLeftIcon />
      <span className="sr-only">Toggle the sidebar</span>
    </Button>
  );
};

export const SidebarInset = ({ className, ...props }: ComponentProps<'main'>) => (
  <main
    data-slot="sidebar-inset"
    className={cn('relative flex w-full min-w-0 flex-1 flex-col bg-background', className)}
    {...props}
  />
);

export const SidebarHeader = ({ className, ...props }: ComponentProps<'div'>) => (
  <div data-slot="sidebar-header" className={cn('flex flex-col gap-2 p-2', className)} {...props} />
);

export const SidebarFooter = ({ className, ...props }: ComponentProps<'div'>) => (
  <div data-slot="sidebar-footer" className={cn('flex flex-col gap-2 p-2', className)} {...props} />
);

export const SidebarContent = ({ className, ...props }: ComponentProps<'div'>) => (
  <div
    data-slot="sidebar-content"
    className={cn(
      'flex min-h-0 flex-1 flex-col gap-2 overflow-auto group-data-[collapsible=icon]:overflow-hidden',
      className,
    )}
    {...props}
  />
);

export const SidebarGroup = ({ className, ...props }: ComponentProps<'div'>) => (
  <div
    data-slot="sidebar-group"
    className={cn('relative flex w-full min-w-0 flex-col p-2', className)}
    {...props}
  />
);

export const SidebarGroupLabel = ({ className, ...props }: ComponentProps<'div'>) => (
  <div
    data-slot="sidebar-group-label"
    className={cn(
      'flex h-8 shrink-0 items-center rounded-md px-2 text-xs font-medium text-sidebar-foreground/70 transition-[margin,opacity] duration-200 ease-linear group-data-[collapsible=icon]:-mt-8 group-data-[collapsible=icon]:opacity-0',
      className,
    )}
    {...props}
  />
);

export const SidebarMenu = ({ className, ...props }: ComponentProps<'ul'>) => (
  <ul
    data-slot="sidebar-menu"
    className={cn('flex w-full min-w-0 flex-col gap-1', className)}
    {...props}
  />
);

export const SidebarMenuItem = ({ className, ...props }: ComponentProps<'li'>) => (
  <li
    data-slot="sidebar-menu-item"
    className={cn('group/menu-item relative', className)}
    {...props}
  />
);

export const SidebarMenuButton = ({
  asChild = false,
  isActive = false,
  tooltip,
  className,
  ...props
}: ComponentProps<'button'> & {
  readonly asChild?: boolean;
  readonly isActive?: boolean;
  readonly tooltip?: string;
}) => {
  const { isMobile, state } = useSidebar();
  const Component = asChild ? Slot.Root : 'button';
  const button = (
    <Component
      data-slot="sidebar-menu-button"
      data-active={isActive}
      className={cn(
        'peer/menu-button flex h-8 w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm ring-sidebar-ring outline-hidden transition-[width,height,padding] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:p-2! [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0',
        className,
      )}
      {...props}
    />
  );
  if (tooltip === undefined) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right" align="center" hidden={state !== 'collapsed' || isMobile}>
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
};
