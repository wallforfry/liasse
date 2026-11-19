import { XIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { plural } from '../../lib/format.ts';
import { Button } from '../ui/button.tsx';

export const BulkActionBar = ({
  count,
  onClear,
  children,
}: {
  readonly count: number;
  readonly onClear: () => void;
  readonly children: ReactNode;
}) => (
  <div
    role="toolbar"
    aria-label="Actions on the selected rows"
    className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/50 px-3 py-2"
  >
    <span className="text-sm font-medium">{plural(count, 'row')} selected</span>
    <div className="ml-auto flex flex-wrap items-center gap-2">
      {children}
      <Button variant="ghost" size="sm" onClick={onClear}>
        <XIcon />
        Clear selection
      </Button>
    </div>
  </div>
);
