import type { TypeView } from '@liasse/sdk';
import { Badge } from '../../components/ui/badge.tsx';

type Status = TypeView['status'];

// Typed by the status enumeration of the contract: a new status fails the build here.
const VARIANTS: Readonly<Record<Status, 'secondary' | 'outline'>> = {
  provisional: 'outline',
  stable: 'secondary',
  merged: 'outline',
};

export const TypeStatusBadge = ({ status }: { readonly status: Status }) => (
  <Badge variant={VARIANTS[status]}>{status}</Badge>
);
