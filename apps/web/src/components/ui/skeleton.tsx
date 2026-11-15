import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils.ts';

export const Skeleton = ({ className, ...props }: ComponentProps<'div'>) => (
  <div
    data-slot="skeleton"
    className={cn('animate-pulse rounded-md bg-accent', className)}
    {...props}
  />
);
