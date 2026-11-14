const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

// FNV-1a over the UTF-16 code units: enough to spread labels over the seeds of the generator.
const hashLabel = (label: string): number =>
  Array.from({ length: label.length }, (_, index) => label.charCodeAt(index)).reduce(
    (hash, unit) => Math.imul(hash ^ unit, FNV_PRIME) >>> 0,
    FNV_OFFSET_BASIS,
  );

export type Prng = () => number;

// Mulberry32, seeded by a label: values in [0, 1), the same sequence for the same label on
// every runtime, since it only uses 32-bit integer arithmetic. Each consumer has its own
// label, so adding a document never shifts the numbers of another one.
export const createPrng = (label: string): Prng => {
  let state = hashLabel(label);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    const mixed = Math.imul(state ^ (state >>> 15), state | 1);
    const remixed = mixed ^ (mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61));
    return ((remixed ^ (remixed >>> 14)) >>> 0) / 0x1_0000_0000;
  };
};
