import { SearchIcon } from 'lucide-react';
import { useState } from 'react';
import { Outlet } from 'react-router';
import { Button } from '../components/ui/button.tsx';
import { Separator } from '../components/ui/separator.tsx';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '../components/ui/sidebar.tsx';
import { TooltipProvider } from '../components/ui/tooltip.tsx';
import { ThemeToggle } from '../theme/theme-toggle.tsx';
import { AppSidebar } from './app-sidebar.tsx';
import { CommandPalette } from './command-palette.tsx';

export const AppLayout = () => {
  const [paletteOpen, setPaletteOpen] = useState(false);
  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
            <Button
              variant="outline"
              className="h-8 w-full max-w-64 justify-start text-muted-foreground"
              onClick={() => {
                setPaletteOpen(true);
              }}
            >
              <SearchIcon />
              <span className="flex-1 text-left">Go to or search...</span>
              <kbd className="pointer-events-none hidden rounded border bg-muted px-1.5 font-mono text-[10px] sm:inline-block">
                Ctrl K
              </kbd>
            </Button>
            <div className="ml-auto">
              <ThemeToggle />
            </div>
          </header>
          <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 p-4 md:p-6">
            <Outlet />
          </div>
        </SidebarInset>
        <CommandPalette open={paletteOpen} setOpen={setPaletteOpen} />
      </SidebarProvider>
    </TooltipProvider>
  );
};
