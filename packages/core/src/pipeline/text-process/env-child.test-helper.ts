// A child that reports the environment it was given, as the message of a failure.
process.send?.({
  type: 'failure',
  code: 'pdf_corrupt',
  message: JSON.stringify({
    keys: Object.keys(process.env).toSorted(),
    canary: process.env.LIASSE_TEST_CANARY_API_KEY ?? null,
  }),
});
