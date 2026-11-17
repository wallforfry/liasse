import { useQuery } from '@tanstack/react-query';
import { useClient } from '../../api/session.ts';

export interface GraphQuery {
  readonly limit: number;
  readonly includePrivate: boolean;
}

export const useGraph = ({ limit, includePrivate }: GraphQuery) => {
  const client = useClient();
  return useQuery({
    queryKey: ['graph', { limit, includePrivate }],
    queryFn: async () => client.graph({ limit, include_private: includePrivate }),
  });
};
