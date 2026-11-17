import type { ReactNode } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card.tsx';

interface SettingsCardProps {
  /** Also the id of the region: one word per section, such as `llm`. */
  readonly id: string;
  readonly title: string;
  readonly description: ReactNode;
  readonly children: ReactNode;
}

/** One section of the settings, a region named by its title. */
export const SettingsCard = ({ id, title, description, children }: SettingsCardProps) => (
  <Card role="region" aria-labelledby={`${id}-title`}>
    <CardHeader>
      {/* Focusable by script only: a page that moves between sections puts the focus here. */}
      <CardTitle id={`${id}-title`} role="heading" aria-level={2} tabIndex={-1}>
        {title}
      </CardTitle>
      <CardDescription>{description}</CardDescription>
    </CardHeader>
    <CardContent className="flex flex-col gap-4">{children}</CardContent>
  </Card>
);
