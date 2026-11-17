import { onTestFinished } from 'vitest';

/** The media queries of the test setup match nothing; with this, reduced motion matches. */
export const withReducedMotion = (): void => {
  const setupQuery = Object.getOwnPropertyDescriptor(window, 'matchMedia');
  const query = (media: string): MediaQueryList =>
    Object.assign(new EventTarget(), {
      matches: media.includes('prefers-reduced-motion'),
      media,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
    });
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: query });
  onTestFinished(() => {
    if (setupQuery !== undefined) Object.defineProperty(window, 'matchMedia', setupQuery);
  });
};
