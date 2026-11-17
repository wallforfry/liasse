import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readSettingsFile, SettingsFileError } from './settings-file.ts';

const KEY = 'synthetic-eval-key-3e8a';

describe('readSettingsFile', () => {
  let folder: string;

  beforeAll(async () => {
    folder = await mkdtemp(join(tmpdir(), 'liasse-eval-settings-'));
  });

  afterAll(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  const fileOf = async (name: string, content: string): Promise<string> => {
    const path = join(folder, name);
    await writeFile(path, content);
    return path;
  };

  it('reads the settings with the schema of the server, defaults included', async () => {
    const path = await fileOf(
      'valid.json',
      JSON.stringify({
        llm: { provider: 'anthropic', api_key: KEY, text_model: 't', vision_model: 'v' },
      }),
    );
    const settings = await readSettingsFile(path);
    expect(settings.llm.api_key).toBe(KEY);
    expect(settings.embedding.provider).toBe('local');
    expect(settings.pipeline.confidence_threshold).toBe(0.7);
  });

  it('names what is wrong, never the values of the file', async () => {
    const path = await fileOf(
      'invalid.json',
      JSON.stringify({ llm: { provider: 'openai-compatible', api_key: KEY, text_model: 't' } }),
    );
    const failure = readSettingsFile(path);
    await expect(failure).rejects.toBeInstanceOf(SettingsFileError);
    const message = await failure.catch((error: unknown) => String(error));
    expect(message).toContain('llm.vision_model');
    expect(message).not.toContain(KEY);
  });

  it('refuses a file that is not JSON', async () => {
    await expect(readSettingsFile(await fileOf('broken.json', '{'))).rejects.toThrow('is not JSON');
  });
});
