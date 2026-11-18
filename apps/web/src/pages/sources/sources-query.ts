export const SOURCES_QUERY_KEY = ['sources'] as const;

export const sourceQueryKey = (id: string) => [...SOURCES_QUERY_KEY, id] as const;
