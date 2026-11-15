import { CheckIcon } from 'lucide-react';
import { DropdownMenu as DropdownMenuPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils.ts';

export const DropdownMenu = (props: ComponentProps<typeof DropdownMenuPrimitive.Root>) => (
  <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />
);

export const DropdownMenuTrigger = (
  props: ComponentProps<typeof DropdownMenuPrimitive.Trigger>,
) => <DropdownMenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />;

export const DropdownMenuContent = ({
  className,
  sideOffset = 4,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Content>) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      data-slot="dropdown-menu-content"
      sideOffset={sideOffset}
      className={cn(
        'z-50 max-h-(--radix-dropdown-menu-content-available-height) min-w-[8rem] origin-(--radix-dropdown-menu-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
        className,
      )}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
);

export const DropdownMenuLabel = ({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Label>) => (
  <DropdownMenuPrimitive.Label
    data-slot="dropdown-menu-label"
    className={cn('px-2 py-1.5 text-sm font-medium', className)}
    {...props}
  />
);

export const DropdownMenuRadioGroup = (
  props: ComponentProps<typeof DropdownMenuPrimitive.RadioGroup>,
) => <DropdownMenuPrimitive.RadioGroup data-slot="dropdown-menu-radio-group" {...props} />;

export const DropdownMenuRadioItem = ({
  className,
  children,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.RadioItem>) => (
  <DropdownMenuPrimitive.RadioItem
    data-slot="dropdown-menu-radio-item"
    className={cn(
      "relative flex cursor-default items-center gap-2 rounded-sm py-1.5 pr-2 pl-8 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
      className,
    )}
    {...props}
  >
    <span className="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <CheckIcon className="size-4" />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitive.RadioItem>
);
