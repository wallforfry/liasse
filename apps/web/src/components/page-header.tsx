import type { ReactNode } from 'react';

export interface PageHeaderProps {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  /** Buttons on the right of the title. */
  readonly actions?: ReactNode;
}

export const PageHeader = ({ title, description, actions }: PageHeaderProps) => (
  <div className="flex flex-wrap items-start justify-between gap-4">
    <div className="min-w-0 space-y-1">
      <h1 className="text-2xl font-semibold tracking-tight break-words">{title}</h1>
      {description === undefined ? null : (
        <p className="text-sm text-muted-foreground">{description}</p>
      )}
    </div>
    {actions === undefined ? null : <div className="flex items-center gap-2">{actions}</div>}
  </div>
);
