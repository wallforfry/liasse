import { describe, expect, it } from 'vitest';
import {
  syntheticDocx,
  syntheticEml,
  syntheticHeic,
  syntheticIsoMedia,
  syntheticJpeg,
  syntheticPdf,
  syntheticPng,
  syntheticZip,
} from '../testing/synthetic-files.ts';
import { detectMimeType } from './mime.ts';
import { zipEntryNames } from './zip-entries.ts';

const text = (value: string): Uint8Array => new TextEncoder().encode(value);

describe('detectMimeType', () => {
  it.each([
    ['application/pdf', syntheticPdf()],
    ['image/jpeg', syntheticJpeg()],
    ['image/png', syntheticPng()],
    ['image/heic', syntheticHeic()],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', syntheticDocx()],
    ['message/rfc822', syntheticEml()],
  ])('recognises %s from its content', (mime, bytes) => {
    expect(detectMimeType(bytes)).toBe(mime);
  });

  it('recognises a HEIC file whose major brand is the generic mif1', () => {
    expect(detectMimeType(syntheticIsoMedia('mif1', ['mif1', 'heic']))).toBe('image/heic');
  });

  it.each([
    ['an AVIF image', syntheticIsoMedia('avif', ['mif1', 'miaf'])],
    ['an MP4 video', syntheticIsoMedia('isom', ['isom', 'mp42'])],
    ['a brand outside the ftyp box', syntheticIsoMedia('avif', [], 'heic')],
    ['a truncated ftyp box', syntheticHeic().subarray(0, 10)],
  ])('does not take %s for a HEIC file', (_label, bytes) => {
    expect(detectMimeType(bytes)).toBeUndefined();
  });

  it.each([
    ['a ZIP archive that is no DOCX', syntheticZip({ 'notes.txt': 'synthetic' })],
    [
      'a spreadsheet',
      syntheticZip({ '[Content_Types].xml': '<Types/>', 'xl/workbook.xml': '<workbook/>' }),
    ],
    ['a ZIP signature without archive', Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0])],
    ['a truncated DOCX', syntheticDocx().subarray(0, 60)],
  ])('rejects %s', (_label, bytes) => {
    expect(detectMimeType(bytes)).toBeUndefined();
  });

  it.each([
    ['plain text', text('Just a synthetic note.\nNothing more.\n')],
    ['text that names no sender', text('Date: today\nSubject: synthetic\n\nbody')],
    ['a sender without any other field', text('From: sender@example.com\n\nbody')],
    ['prose before the headers', text('Hello\nFrom: a@example.com\nSubject: synthetic\n\nbody')],
    ['a broken header line', text('From: a@example.com\nnot a header\nSubject: x\n\nbody')],
    ['headers holding a NUL byte', text('From: a@example.com\nSubject: \0\n\nbody')],
    ['a PDF signature that is not at the start', text(' %PDF-1.7 synthetic')],
    ['HTML', text('<!doctype html><html></html>')],
    ['a single byte', Uint8Array.from([0xff])],
    ['nothing', new Uint8Array()],
  ])('rejects %s', (_label, bytes) => {
    expect(detectMimeType(bytes)).toBeUndefined();
  });

  it('accepts an email with folded headers and bare line feeds', () => {
    const eml = text(
      'Received: from a.example.com\n by b.example.org\nFrom: a@example.com\nDate: now\n\nbody',
    );
    expect(detectMimeType(eml)).toBe('message/rfc822');
  });

  it('accepts an email that is only headers', () => {
    expect(detectMimeType(text('From: a@example.com\nSubject: synthetic\n'))).toBe(
      'message/rfc822',
    );
  });

  it('reads a view over a larger buffer from its own offset', () => {
    const pdf = syntheticPdf();
    const padded = new Uint8Array(pdf.length + 16);
    padded.set(pdf, 16);
    expect(detectMimeType(padded.subarray(16))).toBe('application/pdf');
    const heic = syntheticHeic();
    const paddedHeic = new Uint8Array(heic.length + 16);
    paddedHeic.set(heic, 16);
    expect(detectMimeType(paddedHeic.subarray(16))).toBe('image/heic');
    const docx = syntheticDocx();
    const paddedDocx = new Uint8Array(docx.length + 16);
    paddedDocx.set(docx, 16);
    expect(detectMimeType(paddedDocx.subarray(16))).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
  });
});

describe('zipEntryNames', () => {
  it('lists the entries of an archive', () => {
    expect(zipEntryNames(syntheticZip({ 'a.txt': 'one', 'dir/b.txt': 'two' }))).toEqual([
      'a.txt',
      'dir/b.txt',
    ]);
  });

  it('finds the directory of an archive that ends with a comment', () => {
    const archive = Buffer.from(syntheticZip({ 'a.txt': 'one' }));
    archive.writeUInt16LE(9, archive.length - 2);
    expect(zipEntryNames(Buffer.concat([archive, Buffer.from('synthetic')]))).toEqual(['a.txt']);
  });

  it('survives a directory offset that points outside the archive', () => {
    const archive = Buffer.from(syntheticZip({ 'a.txt': 'one' }));
    archive.writeUInt32LE(0xfffffff0, archive.length - 6);
    expect(zipEntryNames(archive)).toEqual([]);
  });

  it('survives an entry name that runs past the end', () => {
    const archive = Buffer.from(syntheticZip({ 'a.txt': 'one' }));
    const directory = archive.readUInt32LE(archive.length - 6);
    archive.writeUInt16LE(0xffff, directory + 28);
    expect(zipEntryNames(archive)).toEqual([]);
  });
});
