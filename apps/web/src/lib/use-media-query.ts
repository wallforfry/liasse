import { useCallback, useSyncExternalStore } from 'react';

/** Whether the media query matches, kept current as it changes. */
export const useMediaQuery = (media: string): boolean => {
  const subscribe = useCallback(
    (onChange: () => void): (() => void) => {
      const query = window.matchMedia(media);
      query.addEventListener('change', onChange);
      return () => {
        query.removeEventListener('change', onChange);
      };
    },
    [media],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(media).matches);
};
