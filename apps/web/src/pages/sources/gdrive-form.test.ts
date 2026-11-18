import { describe, expect, it } from 'vitest';
import { folderIdOf } from './gdrive-form.ts';

describe('folderIdOf', () => {
  it.each([
    ['https://drive.google.com/drive/folders/1Abc_d-E', '1Abc_d-E'],
    ['https://drive.google.com/drive/folders/1Abc_d-E/', '1Abc_d-E'],
    ['https://drive.google.com/drive/u/0/folders/1Abc_d-E?usp=sharing', '1Abc_d-E'],
    ['  1Abc_d-E  ', '1Abc_d-E'],
    ['root', 'root'],
  ])('reads %s as %s', (input, id) => {
    expect(folderIdOf(input)).toBe(id);
  });

  it('leaves an address that names no folder as typed, for the schema to refuse', () => {
    expect(folderIdOf('https://drive.google.com/file/d/1Abc/view')).toBe(
      'https://drive.google.com/file/d/1Abc/view',
    );
    expect(folderIdOf('https://example.test/drive/folders/1Abc')).toBe(
      'https://example.test/drive/folders/1Abc',
    );
  });
});
