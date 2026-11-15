import type { DocumentView } from '@liasse/sdk';
import { ExternalLinkIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { PrivateBadge, StatusBadge } from '../../components/document-badges.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Table, TableBody, TableCell, TableHead, TableRow } from '../../components/ui/table.tsx';
import { documentFilePath } from '../../layout/navigation.ts';
import { formatTime, plural, shownValue } from '../../lib/format.ts';

// Everything below is read from the document: it is rendered as React text, never as
// markup.

// What a browser shows in an image element; any other file is only offered as a link.
const IMAGE_TYPES: readonly string[] = ['image/jpeg', 'image/png'];

const Row = ({ label, children }: { readonly label: string; readonly children: ReactNode }) => (
  <TableRow>
    <TableHead className="w-40 align-top text-muted-foreground">{label}</TableHead>
    <TableCell className="break-words whitespace-normal">{children}</TableCell>
  </TableRow>
);

export const DocumentDetails = ({ document }: { readonly document: DocumentView }) => (
  <Table>
    <TableBody>
      <Row label="Type">{document.type ?? 'untyped'}</Row>
      <Row label="Status">
        <StatusBadge status={document.status} />
      </Row>
      <Row label="Confidence">{document.confidence ?? ''}</Row>
      <Row label="Privacy">{document.private ? <PrivateBadge /> : 'public'}</Row>
      <Row label="File">
        {document.original_name} ({document.mime})
      </Row>
      <Row label="Ingested">{formatTime(document.ingested_at)}</Row>
      {document.error === null ? null : <Row label="Error">{document.error}</Row>}
    </TableBody>
  </Table>
);

export const ValueTable = ({ values }: { readonly values: Readonly<Record<string, unknown>> }) => {
  const entries = Object.entries(values);
  if (entries.length === 0) return <p className="text-sm text-muted-foreground">None.</p>;
  return (
    <Table>
      <TableBody>
        {entries.map(([name, value]) => (
          <Row key={name} label={name}>
            {shownValue(value)}
          </Row>
        ))}
      </TableBody>
    </Table>
  );
};

export const DocumentText = ({ text }: { readonly text: DocumentView['text'] }) => {
  if (text === undefined || text.content === '') {
    return <p className="text-sm text-muted-foreground">No text.</p>;
  }
  return (
    <div className="space-y-2">
      <pre className="max-h-[70vh] overflow-auto rounded-md border bg-muted/40 p-4 font-mono text-xs whitespace-pre-wrap">
        {text.content}
      </pre>
      {text.has_more ? (
        <p className="text-sm text-muted-foreground">
          The first {String(text.content.length)} of {plural(text.total_length, 'character')} are
          shown.
        </p>
      ) : null}
    </div>
  );
};

export const OriginalFile = ({ document }: { readonly document: DocumentView }) => (
  <div className="space-y-4">
    <Button variant="outline" asChild>
      <a href={documentFilePath(document.id)} target="_blank" rel="noopener noreferrer">
        <ExternalLinkIcon />
        Open the original file
      </a>
    </Button>
    {IMAGE_TYPES.includes(document.mime) ? (
      <img
        src={documentFilePath(document.id)}
        alt="The original image"
        className="max-h-[70vh] max-w-full rounded-md border"
      />
    ) : (
      <p className="text-sm text-muted-foreground">
        Only JPEG and PNG files are shown here; this one opens in a new tab.
      </p>
    )}
  </div>
);
