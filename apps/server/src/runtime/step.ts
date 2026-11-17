import { StartupError } from '@liasse/core/domain';
import { describeError } from '../log.ts';

const reasonOf = (error: unknown): string => {
  const { error: name, sqlstate } = describeError(error);
  const code = error instanceof Error && 'code' in error ? error.code : undefined;
  return [name, typeof code === 'string' ? code : undefined, sqlstate]
    .filter((part, index, parts) => part !== undefined && parts.indexOf(part) === index)
    .join(' ');
};

/**
 * Runs one step of the startup, or of putting settings in force. An error meant for the
 * operator passes as it is; any other becomes one that names the step and the class of
 * what failed, never its message: a driver may quote a connection URL there.
 */
export const step = async <Result>(
  name: string,
  work: () => Result | Promise<Result>,
): Promise<Result> => {
  try {
    return await work();
  } catch (error) {
    if (error instanceof StartupError) throw error;
    throw new StartupError(`Liasse could not start: ${name} failed (${reasonOf(error)}).`, {
      cause: error,
    });
  }
};
