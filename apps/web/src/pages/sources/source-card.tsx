import type { Source } from '@liasse/sdk';
import type { SourceKind } from '@liasse/contract/domain';
import { PencilIcon, PlayIcon, PlugZapIcon } from 'lucide-react';
import { Link } from 'react-router';
import { editSourcePath } from '../../layout/navigation.ts';
import { Badge } from '../../components/ui/badge.tsx';
import { Button } from '../../components/ui/button.tsx';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '../../components/ui/card.tsx';
import { Label } from '../../components/ui/label.tsx';
import { Switch } from '../../components/ui/switch.tsx';
import { plural } from '../../lib/format.ts';
import { DeleteSource } from './delete-source.tsx';
import { SourceCheckResult } from './source-check-result.tsx';
import { needsGoogleConsent } from './google-consent.ts';
import { SourceCredentials } from './source-credentials.tsx';
import { SourceLastRun } from './source-last-run.tsx';
import { useCheckSource, useRunSource, useToggleSource } from './use-source-actions.ts';

const KIND_LABELS: Readonly<Record<SourceKind, string>> = { imap: 'IMAP', gdrive: 'Google Drive' };

const readsWhat = (source: Source): string =>
  source.kind === 'imap'
    ? `${source.config.username} on ${source.config.host}, reading ${source.config.mailboxes.join(', ')}`
    : `Drive folder ${source.config.folder_id}`;

/** One source: what it reads, how its last run went, and what can be done with it. */
export const SourceCard = ({ source }: { readonly source: Source }) => {
  const toggle = useToggleSource(source);
  const run = useRunSource(source.id);
  const check = useCheckSource(source.id);
  const titleId = `source-${source.id}-title`;
  const switchId = `source-${source.id}-enabled`;
  return (
    <Card role="region" aria-labelledby={titleId}>
      <CardHeader>
        <CardTitle id={titleId} role="heading" aria-level={2} className="break-words">
          {source.name}
        </CardTitle>
        <CardDescription>
          <Badge variant="outline" className="mr-2">
            {KIND_LABELS[source.kind]}
          </Badge>
          {source.private ? (
            <Badge variant="secondary" className="mr-2">
              Private
            </Badge>
          ) : null}
          {readsWhat(source)}, every {plural(source.poll_interval_minutes, 'minute')}.
        </CardDescription>
        <CardAction className="flex items-center gap-2">
          <Switch
            id={switchId}
            checked={source.enabled}
            disabled={toggle.isPending}
            onCheckedChange={(checked) => {
              toggle.mutate(checked);
            }}
          />
          <Label htmlFor={switchId}>Enabled</Label>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {source.hint === null ? null : (
          <p className="text-sm break-words">
            <span className="font-medium">Hint:</span> {source.hint}
          </p>
        )}
        <SourceCredentials
          source={source}
          checkRefused={
            check.variables === source.updated_at &&
            check.data?.ok === false &&
            check.data.error.kind === 'credentials'
          }
        />
        <SourceLastRun run={source.last_run} kind={source.kind} />
        <SourceCheckResult data={check.data} error={check.error} />
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={
            !source.enabled || source.needs_attention || needsGoogleConsent(source) || run.isPending
          }
          onClick={() => {
            run.mutate();
          }}
        >
          <PlayIcon />
          Run now
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={check.isPending}
          onClick={() => {
            check.mutate(source.updated_at);
          }}
        >
          <PlugZapIcon />
          {check.isPending ? 'Checking...' : 'Check'}
        </Button>
        <Button variant="outline" size="sm" asChild>
          <Link to={editSourcePath(source.id)}>
            <PencilIcon />
            Edit
          </Link>
        </Button>
        <DeleteSource source={source} />
      </CardFooter>
    </Card>
  );
};
