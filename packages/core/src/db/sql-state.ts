const SQLSTATE = /^[0-9A-Z]{5}$/;

/** The SQLSTATE of a database failure, looked for down the causes: Drizzle wraps the driver error. */
export const sqlStateOf = (error: unknown): string | undefined => {
  if (!(error instanceof Error)) return undefined;
  return 'code' in error && typeof error.code === 'string' && SQLSTATE.test(error.code)
    ? error.code
    : sqlStateOf(error.cause);
};
