import type { MessageStructureObject } from 'imapflow';

const BODY_TYPES: ReadonlySet<string> = new Set(['text/plain', 'text/html']);

// The rule of the email extraction of the pipeline, read from BODYSTRUCTURE: a part shown in
// the message (disposition `inline`, or a resource of a `multipart/related` body) is not an
// attachment; a text part without a disposition is the body.
const isAttachment = (part: MessageStructureObject, related: boolean): boolean => {
  const disposition = part.disposition?.toLowerCase();
  // A forwarded message attached has a structure of its own: it is one attachment.
  if (disposition === 'attachment') return true;
  if (part.childNodes !== undefined && part.childNodes.length > 0) {
    const inRelated = related || part.type.toLowerCase() === 'multipart/related';
    return part.childNodes.some((child) => isAttachment(child, inRelated));
  }
  if (disposition === 'inline' || related) return false;
  return !BODY_TYPES.has(part.type.toLowerCase());
};

/** Whether a message carries at least one file that is not displayed inside it. */
export const hasAttachment = (structure: MessageStructureObject | undefined): boolean =>
  structure !== undefined && isAttachment(structure, false);
