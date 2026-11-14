import { defineProject } from 'vitest/config';
import { sourceResolution, TEST_FILES } from '../vitest.shared.ts';

// Building the corpus draws a dozen pages and encodes them in pure JavaScript, and
// reading it back renders them with pdftoppm. One build was measured at 2.6 s on a laptop
// and at about 3 s on a CI runner, where a test that built it twice took 6.3 s against
// the default limit of 5 s. The limit is sized far above the work: it only ends a hang.
const RENDER_TIMEOUT_MILLISECONDS = 60_000;

export default defineProject({
  ...sourceResolution,
  test: {
    name: 'eval',
    include: TEST_FILES,
    testTimeout: RENDER_TIMEOUT_MILLISECONDS,
    hookTimeout: RENDER_TIMEOUT_MILLISECONDS,
  },
});
