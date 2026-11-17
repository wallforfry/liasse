import { readFile } from 'node:fs/promises';
import { type Settings, settingsSchema } from '@liasse/contract';

/** The file of settings is wrong; the message names where, never what it holds. */
export class SettingsFileError extends Error {
  override readonly name = 'SettingsFileError';
}

const parseJson = (text: string, path: string): unknown => {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new SettingsFileError(`${path} is not JSON.`, { cause: error });
  }
};

/**
 * The model settings of a run, read from a JSON file in the shape the server stores them,
 * keys included, and checked by the same schema. Its keys never reach a report.
 */
export const readSettingsFile = async (path: string): Promise<Settings> => {
  const parsed = settingsSchema.safeParse(parseJson(await readFile(path, 'utf8'), path));
  if (parsed.success) return parsed.data;
  const problems = parsed.error.issues.map(
    ({ path: where, message }) => `  - ${where.map(String).join('.')}: ${message}`,
  );
  throw new SettingsFileError([`${path} holds invalid settings:`, ...problems].join('\n'));
};
