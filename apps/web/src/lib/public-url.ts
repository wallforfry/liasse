import { PUBLIC_URL_META_PROPERTY } from '@liasse/contract';

/**
 * `PUBLIC_URL`, as the server wrote it into this page; undefined on a page the server did not
 * write, such as the one of the Vite dev server, whose own origin is another.
 */
export const publicUrl = (): string | undefined => {
  const content = document
    .querySelector(`meta[property="${PUBLIC_URL_META_PROPERTY}"]`)
    ?.getAttribute('content');
  return content === null || content === undefined || content === '' ? undefined : content;
};
