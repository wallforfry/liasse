import type { Plugin } from 'vite';

const SONNER_MODULE = /[\\/]sonner[\\/]dist[\\/]index\.m?js$/;
// The one call that writes the stylesheet of Sonner into a new `<style>` at load time.
const INSERT_CSS = /__insertCSS\("(?:[^"\\]|\\.)*"\);?/;

/**
 * Sonner inserts its stylesheet as a `<style>` element without a nonce when it loads,
 * which the policy of `/ui` refuses. This drops that call; the application imports the
 * same rules from `sonner/dist/styles.css` into its own stylesheet instead. The build
 * fails if the call is no longer found, or if no module of Sonner went through here, so
 * an upgrade that moves or renames it cannot bring the violation back.
 */
export const sonnerStylesheet = (): Plugin => {
  let transformed = 0;
  return {
    name: 'liasse:sonner-stylesheet',
    apply: 'build',
    enforce: 'pre',
    buildStart() {
      transformed = 0;
    },
    transform(code, id) {
      if (!SONNER_MODULE.test(id)) return null;
      if (!INSERT_CSS.test(code)) {
        this.error(`The stylesheet call of Sonner was not found in ${id}.`);
      }
      transformed += 1;
      return { code: code.replace(INSERT_CSS, ''), map: null };
    },
    buildEnd(error) {
      if (error === undefined && transformed === 0) {
        this.error('No module of Sonner was built: its stylesheet call may run unseen.');
      }
    },
  };
};
