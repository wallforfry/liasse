import { InfoIcon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert.tsx';
import { Button } from '../../components/ui/button.tsx';
import type { EntityFilter } from './list-params.ts';

export interface MissingEntityNoticeProps {
  readonly entity: EntityFilter;
  readonly onClear: () => void;
}

export const MissingEntityNotice = ({ entity, onClear }: MissingEntityNoticeProps) => (
  <Alert>
    <InfoIcon />
    <AlertTitle>Unknown entity</AlertTitle>
    <AlertDescription>
      <p>
        No entity has the id this address gives for {entity.name}. It may have been merged into
        another entity, which now holds its documents, or the address may name an entity that never
        existed. Pick the entity again to see its documents.
      </p>
      <Button type="button" variant="outline" size="sm" onClick={onClear}>
        Clear the entity filter
      </Button>
    </AlertDescription>
  </Alert>
);
