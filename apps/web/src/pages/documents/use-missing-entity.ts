import { LiasseApiError } from '@liasse/sdk';
import { useQuery } from '@tanstack/react-query';
import { useClient } from '../../api/session.ts';
import type { EntityFilter } from './list-params.ts';

const isEntityNotFound = (error: unknown): boolean =>
  error instanceof LiasseApiError && error.code === 'entity_not_found';

/**
 * The entity of the filter when the server knows no entity by its id: a merge deletes
 * its source, so an address saved before the merge filters on an id no document carries
 * any more. Any other failure of the lookup leaves the filter as it is.
 */
export const useMissingEntity = (entity: EntityFilter | undefined): EntityFilter | undefined => {
  const client = useClient();
  const id = entity?.id ?? '';
  const lookup = useQuery({
    queryKey: ['entity', id],
    queryFn: async () => client.getEntity(id),
    enabled: entity !== undefined,
  });
  return lookup.isError && isEntityNotFound(lookup.error) ? entity : undefined;
};
