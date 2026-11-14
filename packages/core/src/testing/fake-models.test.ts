import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ModelOutputError } from '../models/errors.ts';
import { createFakeTextModel } from './fake-text-model.ts';
import { createFakeVisionModel } from './fake-vision-model.ts';

const classification = z.strictObject({
  decision: z.enum(['existing', 'new']),
  confidence: z.number().min(0).max(1),
});

const request = { schema: classification, system: 'Classify.', prompt: 'An energy bill.' };

describe('createFakeTextModel', () => {
  it('returns scripted responses in order and records the calls', async () => {
    const model = createFakeTextModel([
      { decision: 'existing', confidence: 0.9 },
      { decision: 'new', confidence: 0.4 },
    ]);
    expect(await model.generateObject(request)).toEqual({
      object: { decision: 'existing', confidence: 0.9 },
      model: 'fake-text-model',
    });
    expect((await model.generateObject(request)).object.decision).toBe('new');
    expect(model.calls).toEqual([request, request]);
  });

  it('fails once the script is exhausted', async () => {
    const model = createFakeTextModel([{ decision: 'existing', confidence: 1 }]);
    await model.generateObject(request);
    await expect(model.generateObject(request)).rejects.toThrow(/no scripted response/);
  });

  it('derives responses from a handler', async () => {
    const model = createFakeTextModel(({ prompt }) => ({
      decision: prompt.includes('bill') ? 'existing' : 'new',
      confidence: 0.8,
    }));
    expect((await model.generateObject(request)).object.decision).toBe('existing');
    expect((await model.generateObject({ ...request, prompt: 'A letter.' })).object.decision).toBe(
      'new',
    );
  });

  it('rejects a response that does not match the schema', async () => {
    const model = createFakeTextModel([{ decision: 'maybe', confidence: 2 }], 'scripted');
    const failure = model.generateObject(request);
    await expect(failure).rejects.toBeInstanceOf(ModelOutputError);
    await expect(failure).rejects.toMatchObject({ model: 'scripted' });
    await expect(failure).rejects.toThrow(/decision/);
  });

  it('applies the transformations of the schema', async () => {
    const model = createFakeTextModel([{ title: '  Energy bill  ' }]);
    const { object } = await model.generateObject({
      schema: z.object({ title: z.string().trim() }),
      system: '',
      prompt: '',
    });
    expect(object.title).toBe('Energy bill');
  });

  it('honours an aborted signal', async () => {
    const model = createFakeTextModel([{ decision: 'new', confidence: 1 }]);
    await expect(
      model.generateObject({ ...request, signal: AbortSignal.abort() }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(model.calls).toHaveLength(0);
  });
});

describe('createFakeVisionModel', () => {
  const page = {
    image: new TextEncoder().encode('# Invoice 42\n\nTotal: 84.20 EUR'),
    mime: 'image/png',
    prompt: 'Transcribe.',
  };

  it('transcribes the image bytes as text by default', async () => {
    const model = createFakeVisionModel();
    expect(await model.transcribePage(page)).toEqual({
      markdown: '# Invoice 42\n\nTotal: 84.20 EUR',
      model: 'fake-vision-model',
    });
    expect(model.calls).toEqual([page]);
  });

  it('uses a custom handler', async () => {
    const model = createFakeVisionModel(({ mime }) => `page rendered from ${mime}`, 'scripted');
    expect(await model.transcribePage(page)).toEqual({
      markdown: 'page rendered from image/png',
      model: 'scripted',
    });
  });

  it('honours an aborted signal', async () => {
    const model = createFakeVisionModel();
    await expect(
      model.transcribePage({ ...page, signal: AbortSignal.abort() }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
