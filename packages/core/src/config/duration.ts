const UNIT_MS = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
} as const;

type DurationUnit = keyof typeof UNIT_MS;

const isDurationUnit = (unit: string): unit is DurationUnit => Object.hasOwn(UNIT_MS, unit);

const DURATION_PATTERN = /^(\d+)(ms|s|m|h|d|w)$/;

export const parseDuration = (value: string): number | undefined => {
  const match = DURATION_PATTERN.exec(value.trim());
  const amount = match?.[1];
  const unit = match?.[2];
  if (amount === undefined || unit === undefined || !isDurationUnit(unit)) return undefined;
  const milliseconds = Number(amount) * UNIT_MS[unit];
  return Number.isSafeInteger(milliseconds) && milliseconds > 0 ? milliseconds : undefined;
};
