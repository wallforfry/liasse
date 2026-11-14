import { describe, expect, it } from 'vitest';
import { checkEmail, EMAIL_SAMPLE_BYTES } from './email.ts';

const text = (value: string): Uint8Array => new TextEncoder().encode(value);

const SENDERS = ['From', 'Sender', 'Return-Path'];
const MESSAGE_FIELDS = ['Date', 'Subject', 'To', 'Message-ID', 'Received', 'mime-version'];

// One header line of exactly `bytes` bytes, line feed included.
const paddingLine = (bytes: number): string => `X-Synthetic: ${'x'.repeat(bytes - 14)}\n`;

describe('checkEmail', () => {
  it.each(SENDERS.flatMap((sender) => MESSAGE_FIELDS.map((field) => [sender, field])))(
    'accepts a header block naming %s and %s',
    (sender, field) => {
      expect(checkEmail(text(`${field}: synthetic\n${sender}: a@example.com\n\nBody.`))).toEqual({
        email: true,
      });
    },
  );

  it.each([
    [
      'folded headers',
      'Received: from a.example.com\n\tby b.example.org\nFrom: a@example.com\n\nB',
    ],
    ['headers alone, without a final line break', 'From: a@example.com\nSubject: synthetic'],
    ['headers alone, with a final line break', 'From: a@example.com\r\nSubject: synthetic\r\n'],
    ['a NUL byte beyond the sample', `From: a@b.example\nTo: c\n\n${'x'.repeat(70_000)}\0`],
  ])('accepts %s', (_label, content) => {
    expect(checkEmail(text(content))).toEqual({ email: true });
  });

  it.each([
    ['an empty file', '', 'it does not start with a header field'],
    ['prose', 'Dear Jane Doe,\n\nNo header above.', 'it does not start with a header field'],
    [
      'a continuation line first',
      ' From: a@example.com\nTo: b\n',
      'it does not start with a header field',
    ],
    [
      'a space before the colon',
      'From : a@example.com\nTo: b\n',
      'it does not start with a header field',
    ],
    ['a byte order mark', '﻿From: a@example.com\nTo: b\n', 'it does not start with a header field'],
    [
      'a blank line first',
      '\nFrom: a@example.com\nTo: b\n',
      'it does not start with a header field',
    ],
    [
      'a line that is no header',
      'From: a@example.com\nnot a header\nTo: b\n\nBody.',
      'its header block holds a line that is not a header field',
    ],
    ['a NUL byte', 'From: a@example.com\nSubject: \0\n\nBody.', 'it holds a NUL byte'],
    ['no sender', 'Date: today\nSubject: synthetic\n\nBody.', 'it names no sender'],
    ['a sender alone', 'From: a@example.com\n\nBody.', 'it has no other field of a message'],
    ['a sender only in the body', 'Subject: s\n\nFrom: a@example.com', 'it names no sender'],
    [
      'two senders',
      'From: a@example.com\nSender: b@example.com\n',
      'it has no other field of a message',
    ],
  ])('refuses %s', (_label, content, reason) => {
    expect(checkEmail(text(content))).toEqual({ email: false, reason });
  });

  it('reads the header block up to the end of its sample and no further', () => {
    const fields = 'From: a@example.com\nSubject: s\n';
    const within = `${paddingLine(EMAIL_SAMPLE_BYTES - fields.length)}${fields}`;
    expect(text(within)).toHaveLength(EMAIL_SAMPLE_BYTES);
    expect(checkEmail(text(`${within}more: headers\n\nBody.`)).email).toBe(true);
    const beyond = `${paddingLine(EMAIL_SAMPLE_BYTES - fields.length + 1)}${fields}`;
    expect(checkEmail(text(`${beyond}\nBody.`))).toEqual({
      email: false,
      reason: 'it has no other field of a message',
    });
  });

  it('ignores the line the sample cuts, but not a whole line that is no header', () => {
    const fields = 'From: a@example.com\nSubject: s\n';
    const filled = `${paddingLine(EMAIL_SAMPLE_BYTES - fields.length - 4)}${fields}`;
    expect(checkEmail(text(`${filled}not a header at all\n\nBody.`)).email).toBe(true);
    expect(checkEmail(text(`${filled}no\nX: y\n\nBody.`)).email).toBe(false);
  });
});
