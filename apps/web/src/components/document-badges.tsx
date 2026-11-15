import type { DocumentSummary } from '@liasse/sdk';
import { LockIcon } from 'lucide-react';
import { statusLabel } from '../lib/format.ts';
import { Badge } from './ui/badge.tsx';

type Status = DocumentSummary['status'];

// Typed by the status enumeration of the contract: a new status fails the build here.
const VARIANTS: Readonly<Record<Status, 'default' | 'secondary' | 'destructive' | 'outline'>> = {
  received: 'outline',
  extracted: 'outline',
  classified: 'outline',
  indexed: 'secondary',
  needs_review: 'default',
  failed: 'destructive',
};

export const StatusBadge = ({ status }: { readonly status: Status }) => (
  <Badge variant={VARIANTS[status]}>{statusLabel(status)}</Badge>
);

export const PrivateBadge = () => (
  <Badge variant="outline">
    <LockIcon />
    private
  </Badge>
);
