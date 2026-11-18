import { PUBLIC_URL_META_PROPERTY } from '@liasse/contract';

/**
 * `PUBLIC_URL`, as the server wrote it into this page. The page of the Vite dev server has
 * none: it is reached at the address it proxies, so its own origin stands for it there.
 */
export const publicUrl = (): string => {
  const meta = document.querySelector(`meta[property="${PUBLIC_URL_META_PROPERTY}"]`);
  const content = meta?.getAttribute('content') ?? '';
  return content === '' ? window.location.origin : content;
};
