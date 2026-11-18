import { LiasseApiError } from '@liasse/sdk';
import { useQuery } from '@tanstack/react-query';
import { useClient } from '../../api/session.ts';
import type { EntityFilter } from './list-params.ts';

/** `checking` until the server answers, so the list is not asked for an id that is gone. */
export type EntityCheck = 'checking' | 'missing' | 'listed';

const isEntityNotFound = (error: unknown): boolean =>
  error instanceof LiasseApiError && error.code === 'entity_not_found';

/**
 * Whether the server knows the entity of the filter by its id: a merge deletes its
 * source, so an address saved before the merge filters on an id no document carries any
 * more. Any other failure of the lookup leaves the filter as it is: `listed`.
 */
export const useEntityCheck = (entity: EntityFilter | undefined): EntityCheck => {
  const client = useClient();
  const id = entity?.id ?? '';
  const lookup = useQuery({
    queryKey: ['entity', id],
    queryFn: async () => client.getEntity(id),
    enabled: entity !== undefined,
  });
  if (entity === undefined) return 'listed';
  if (lookup.isPending) return 'checking';
  return lookup.isError && isEntityNotFound(lookup.error) ? 'missing' : 'listed';
};
