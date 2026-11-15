import type { Plugin } from 'vite';

const SONNER_MODULE = /[\\/]sonner[\\/]dist[\\/]index\.m?js$/;
// The one call that writes the stylesheet of Sonner into a new `<style>` at load time.
const INSERT_CSS = /__insertCSS\("(?:[^"\\]|\\.)*"\);?/;

/**
 * Sonner inserts its stylesheet as a `<style>` element without a nonce when it loads,
 * which the policy of `/ui` refuses. This drops that call; the application imports the
 * same rules from `sonner/dist/styles.css` into its own stylesheet instead. The build
 * fails if the call is no longer found, so an upgrade cannot bring the violation back.
 */
export const sonnerStylesheet = (): Plugin => ({
  name: 'liasse:sonner-stylesheet',
  enforce: 'pre',
  transform(code, id) {
    if (!SONNER_MODULE.test(id)) return null;
    if (!INSERT_CSS.test(code)) {
      this.error(`The stylesheet call of Sonner was not found in ${id}.`);
    }
    return { code: code.replace(INSERT_CSS, ''), map: null };
  },
});
