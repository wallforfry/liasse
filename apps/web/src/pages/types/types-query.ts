import { useQuery } from '@tanstack/react-query';
import { useClient } from '../../api/session.ts';

/** The prefix of every query of the registry, the type picker's included. */
export const TYPES_QUERY_KEY = ['types'] as const;

/** Every type that is not merged, counted without private documents unless asked. */
export const useTypes = (includePrivate: boolean) => {
  const client = useClient();
  return useQuery({
    queryKey: [...TYPES_QUERY_KEY, { includePrivate }],
    queryFn: async () => client.listTypes({ include_private: includePrivate }),
  });
};

export const typePath = (slug: string): string => `/types/${encodeURIComponent(slug)}`;
