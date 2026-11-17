import type { SettingsModels, SettingsModelsRequestInput } from '@liasse/sdk';
import { type UseMutationResult, useMutation } from '@tanstack/react-query';
import { ChevronsUpDownIcon } from 'lucide-react';
import { useState } from 'react';
import { useClient } from '../../api/session.ts';
import { ErrorAlert } from '../../components/error-alert.tsx';
import { Button } from '../../components/ui/button.tsx';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '../../components/ui/command.tsx';
import { Input } from '../../components/ui/input.tsx';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover.tsx';
import { describedBy, type FieldFrame } from './field-frame.ts';
import { Field, TextField } from './settings-fields.tsx';

type ModelListing = UseMutationResult<SettingsModels, Error, SettingsModelsRequestInput>;

const Notice = ({ children }: { readonly children: string }) => (
  <p className="p-4 text-sm text-muted-foreground">{children}</p>
);

const ModelChoices = ({
  label,
  listing,
  onPick,
}: {
  readonly label: string;
  readonly listing: ModelListing;
  readonly onPick: (model: string) => void;
}) => {
  if (listing.error !== null) {
    return (
      <div className="p-2">
        <ErrorAlert error={listing.error} title="Models not listed" />
      </div>
    );
  }
  if (listing.data === undefined) return <Notice>Listing the models...</Notice>;
  if (listing.data.status === 'failed') return <Notice>{listing.data.message}</Notice>;
  if (listing.data.models.length === 0) return <Notice>The provider lists no model.</Notice>;
  return (
    <Command label={`Models for ${label}`}>
      <CommandInput placeholder="Search the models" />
      <CommandList>
        <CommandEmpty>No model matches. Close this list and type the id instead.</CommandEmpty>
        <CommandGroup>
          {listing.data.models.map((model) => (
            <CommandItem
              key={model}
              value={model}
              onSelect={() => {
                onPick(model);
              }}
            >
              {model}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  );
};

interface ModelFieldProps extends FieldFrame {
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** The endpoint of the section as the form holds it, read when the list opens. */
  readonly request: SettingsModelsRequestInput;
  readonly disabled?: boolean;
}

/** A model id, typed or picked from the models the provider lists. */
const ModelField = ({ value, onChange, request, disabled, ...frame }: ModelFieldProps) => {
  const client = useClient();
  const [open, setOpen] = useState(false);
  const listing = useMutation({
    mutationFn: async (asked: SettingsModelsRequestInput) => client.listSettingsModels(asked),
  });
  return (
    <Field frame={frame}>
      <div className="flex gap-2">
        <Input
          id={frame.id}
          value={value}
          disabled={disabled}
          aria-invalid={frame.error === undefined ? undefined : true}
          aria-describedby={describedBy(frame)}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
        <Popover
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (next) listing.mutate(request);
          }}
        >
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={disabled}
              aria-expanded={open}
              aria-label={`Browse the models for ${frame.label}`}
            >
              <ChevronsUpDownIcon />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-0">
            <ModelChoices
              label={frame.label}
              listing={listing}
              onPick={(model) => {
                onChange(model);
                setOpen(false);
              }}
            />
          </PopoverContent>
        </Popover>
      </div>
    </Field>
  );
};

/** A model field with the list of the provider when `request` says where to read it. */
export const ModelOrTextField = ({
  request,
  ...field
}: Omit<ModelFieldProps, 'request'> & {
  readonly request: SettingsModelsRequestInput | undefined;
}) =>
  request === undefined ? <TextField {...field} /> : <ModelField request={request} {...field} />;
