// A problem the operator must fix before the process can start. Its message is complete
// on its own, so entry points print it without a stack trace.
export class StartupError extends Error {
  override readonly name: string = 'StartupError';
}
