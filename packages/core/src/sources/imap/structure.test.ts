import type { MessageStructureObject } from 'imapflow';
import { describe, expect, it } from 'vitest';
import { hasAttachment } from './structure.ts';

const part = (
  type: string,
  extra: Partial<MessageStructureObject> = {},
): MessageStructureObject => ({ type, ...extra });

const mixed = (...childNodes: MessageStructureObject[]) => part('multipart/mixed', { childNodes });

describe('whether a message has an attachment, from its BODYSTRUCTURE', () => {
  it('finds an attached file', () => {
    const pdf = part('application/pdf', { disposition: 'attachment' });
    expect(hasAttachment(mixed(part('text/plain'), pdf))).toBe(true);
  });

  it('counts a file without a disposition, but not the text of the body', () => {
    expect(hasAttachment(mixed(part('text/plain'), part('application/pdf')))).toBe(true);
    const alternative = part('multipart/alternative', {
      childNodes: [part('text/plain'), part('text/html')],
    });
    expect(hasAttachment(alternative)).toBe(false);
    expect(hasAttachment(part('text/plain'))).toBe(false);
    expect(hasAttachment(part('application/pdf'))).toBe(true);
  });

  it('leaves out what is shown inside the message', () => {
    const inline = part('image/png', { disposition: 'inline' });
    expect(hasAttachment(mixed(part('text/html'), inline))).toBe(false);
    const related = part('multipart/related', {
      childNodes: [part('text/html'), part('image/png')],
    });
    expect(hasAttachment(related)).toBe(false);
    const attachedInRelated = part('multipart/related', {
      childNodes: [part('text/html'), part('application/pdf', { disposition: 'attachment' })],
    });
    expect(hasAttachment(attachedInRelated)).toBe(true);
  });

  it('counts a forwarded message attached as one attachment', () => {
    const forwarded = part('message/rfc822', {
      disposition: 'attachment',
      childNodes: [part('text/plain')],
    });
    expect(hasAttachment(mixed(part('text/plain'), forwarded))).toBe(true);
  });

  it('answers false without a structure', () => {
    expect(hasAttachment(undefined)).toBe(false);
  });
});
