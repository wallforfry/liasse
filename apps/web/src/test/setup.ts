import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';
import { WAIT_LIMIT_MILLISECONDS } from './time-limits.ts';

configure({ asyncUtilTimeout: WAIT_LIMIT_MILLISECONDS });

afterEach(() => {
  cleanup();
});

// jsdom lays nothing out: Radix and cmdk observe sizes and scroll the selected item into
// view, which it does not implement.
const ignored = (): void => undefined;
class StillResizeObserver {
  readonly observe = ignored;
  readonly unobserve = ignored;
  readonly disconnect = ignored;
}
Object.defineProperty(window, 'ResizeObserver', { configurable: true, value: StillResizeObserver });
Object.defineProperty(Element.prototype, 'scrollIntoView', {
  configurable: true,
  value: () => undefined,
});
// Nor pointer capture, which Radix Select and the graph's drags call on a press.
Object.defineProperties(Element.prototype, {
  setPointerCapture: { configurable: true, value: ignored },
  releasePointerCapture: { configurable: true, value: ignored },
  hasPointerCapture: { configurable: true, value: () => false },
});

// jsdom has no media queries; the application reads the theme and the width from them.
Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  value: (query: string): MediaQueryList => {
    const list = new EventTarget();
    return Object.assign(list, {
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: (event: Event) => EventTarget.prototype.dispatchEvent.call(list, event),
    });
  },
});
