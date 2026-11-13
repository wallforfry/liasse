const SOURCE_CONDITIONS = ['@liasse/source'];

export const sourceResolution = {
  resolve: { conditions: SOURCE_CONDITIONS },
  ssr: { resolve: { conditions: SOURCE_CONDITIONS } },
} as const;

export const TEST_FILES = ['src/**/*.test.ts'];
