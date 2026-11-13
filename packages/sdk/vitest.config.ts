import { defineProject } from 'vitest/config';
import { sourceResolution, TEST_FILES } from '../../vitest.shared.ts';

export default defineProject({
  ...sourceResolution,
  test: { name: 'sdk', include: TEST_FILES },
});
