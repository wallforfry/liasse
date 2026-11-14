// Whether an extension version such as `0.8.1` is `minimum` or later. A version that is not
// dot-separated integers is never at least anything.
export const isVersionAtLeast = (version: string, minimum: readonly number[]): boolean => {
  const parts = version.split('.').map(Number);
  if (parts.some((part) => !Number.isInteger(part))) return false;
  const difference = minimum
    .map((least, index) => (parts[index] ?? 0) - least)
    .find((delta) => delta !== 0);
  return difference === undefined || difference > 0;
};
