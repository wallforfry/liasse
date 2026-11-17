import type { ReactNode } from 'react';

export interface FieldFrame {
  readonly id: string;
  readonly label: string;
  readonly hint?: ReactNode;
  /** What the schema or the server refused in this field. */
  readonly error?: string | undefined;
}

export const describedBy = ({ id, hint, error }: FieldFrame): string | undefined => {
  const ids = [
    ...(hint === undefined ? [] : [`${id}-hint`]),
    ...(error === undefined ? [] : [`${id}-error`]),
  ];
  return ids.length === 0 ? undefined : ids.join(' ');
};
