import { SUPPORTED_MIMES } from '@liasse/contract/domain';
import { describe, expect, it } from 'vitest';
import { mayBeSupported } from './declared.ts';

describe('mayBeSupported', () => {
  it.each(SUPPORTED_MIMES)('takes a file listed as %s, whatever its name', (type) => {
    expect(mayBeSupported({ name: 'scan', type })).toBe(true);
  });

  it.each([
    ['invoice.PDF', 'application/octet-stream'],
    ['photo.jpeg', undefined],
    ['IMG_0001.HEIC', 'application/octet-stream'],
    ['letter.docx', 'application/zip'],
    ['message.eml', 'text/plain'],
  ])('takes %s, listed as %s, by its extension', (name, type) => {
    expect(mayBeSupported({ name, type })).toBe(true);
  });

  it('reads the type without its parameters and its case', () => {
    expect(mayBeSupported({ name: 'scan', type: ' Application/PDF; charset=binary' })).toBe(true);
  });

  it.each([
    ['film.torrent', 'application/x-bittorrent'],
    ['setup.exe', 'application/x-msdownload'],
    ['app.apk', 'application/vnd.android.package-archive'],
    ['clip.MOV', 'video/quicktime'],
    ['clip.avi', 'video/x-msvideo'],
    ['archive.zip', 'application/zip'],
    ['data.xml', 'text/xml'],
    ['README', 'application/octet-stream'],
    ['pdf', undefined],
    ['report.pdf.zip', 'application/zip'],
  ])('leaves out %s, listed as %s', (name, type) => {
    expect(mayBeSupported({ name, type })).toBe(false);
  });
});
