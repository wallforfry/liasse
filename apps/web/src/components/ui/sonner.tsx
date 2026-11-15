import { Toaster as Sonner, type ToasterProps } from 'sonner';
import { useTheme } from '../../theme/theme.ts';

export const Toaster = (props: ToasterProps) => {
  const { resolvedTheme } = useTheme();
  return (
    <Sonner
      theme={resolvedTheme}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast: 'group-[.toaster]:bg-popover group-[.toaster]:text-popover-foreground',
        },
      }}
      {...props}
    />
  );
};
