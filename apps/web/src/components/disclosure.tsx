import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';
import { Button } from './ui/button.tsx';

/** A button that shows or hides what follows it; hidden content is not rendered. */
export const Disclosure = ({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) => {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="-ml-2"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => {
            setOpen((current) => !current);
          }}
        >
          {open ? <ChevronDownIcon /> : <ChevronRightIcon />}
          {label}
        </Button>
      </div>
      {open ? <div id={id}>{children}</div> : null}
    </div>
  );
};
