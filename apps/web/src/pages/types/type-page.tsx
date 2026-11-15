import type { TypeView } from '@liasse/sdk';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { ErrorAlert } from '../../components/error-alert.tsx';
import { PageHeader } from '../../components/page-header.tsx';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.tsx';
import { Skeleton } from '../../components/ui/skeleton.tsx';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table.tsx';
import { parametersLabel, primitiveLabel } from './field-drafts.ts';
import { TypeStatusBadge } from './type-status-badge.tsx';
import { typePath, useTypes } from './types-query.ts';

const documentsOfType = (slug: string): string =>
  `/documents?${new URLSearchParams({ type: slug }).toString()}`;

const Detail = ({ label, children }: { readonly label: string; readonly children: ReactNode }) => (
  <div className="grid gap-1">
    <dt className="text-xs text-muted-foreground">{label}</dt>
    <dd className="text-sm">{children}</dd>
  </div>
);

const FieldTable = ({ fields }: { readonly fields: TypeView['fields'] }) => {
  const entries = Object.entries(fields);
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">No field of its own: the core only.</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Field</TableHead>
          <TableHead>Primitive</TableHead>
          <TableHead>Values or format</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map(([name, definition]) => (
          <TableRow key={name}>
            <TableCell className="font-mono">{name}</TableCell>
            <TableCell className="font-mono">{primitiveLabel(definition)}</TableCell>
            <TableCell className="whitespace-normal text-muted-foreground">
              {parametersLabel(definition)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};

const TypeDetails = ({
  type,
  all,
}: {
  readonly type: TypeView;
  readonly all: readonly TypeView[];
}) => {
  const children = all.filter(({ parent_slug }) => parent_slug === type.slug);
  return (
    <>
      <PageHeader
        title={<span className="font-mono">{type.slug}</span>}
        description={type.description}
      />
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Detail label="Status">
          <TypeStatusBadge status={type.status} />
        </Detail>
        <Detail label="Version">{type.version}</Detail>
        <Detail label="Parent">
          {type.parent_slug === null ? (
            'none'
          ) : (
            <Link
              to={typePath(type.parent_slug)}
              className="font-mono underline-offset-4 hover:underline"
            >
              {type.parent_slug}
            </Link>
          )}
        </Detail>
        <Detail label="Public documents">
          <Link to={documentsOfType(type.slug)} className="underline-offset-4 hover:underline">
            {type.document_count}
          </Link>
        </Detail>
        {type.aliases.length === 0 ? null : (
          <Detail label="Aliases">
            <span className="font-mono">{type.aliases.join(', ')}</span>
          </Detail>
        )}
        {children.length === 0 ? null : (
          <Detail label="Children">
            {children.map(({ slug }) => (
              <Link
                key={slug}
                to={typePath(slug)}
                className="mr-2 font-mono underline-offset-4 hover:underline"
              >
                {slug}
              </Link>
            ))}
          </Detail>
        )}
      </dl>
      <Card>
        <CardHeader>
          <CardTitle>Fields</CardTitle>
        </CardHeader>
        <CardContent>
          <FieldTable fields={type.fields} />
        </CardContent>
      </Card>
    </>
  );
};

/** One type, found in the registry by its slug or one of its aliases. */
export const TypePage = () => {
  const { slug = '' } = useParams();
  const types = useTypes(false);
  if (types.isPending) return <Skeleton className="h-48 w-full" />;
  if (types.isError) return <ErrorAlert error={types.error} title="The type could not be read" />;
  const type = types.data.types.find(
    (candidate) => candidate.slug === slug || candidate.aliases.includes(slug),
  );
  return type === undefined ? (
    <PageHeader title="No such type" description="No type of the registry has this slug." />
  ) : (
    <TypeDetails type={type} all={types.data.types} />
  );
};
