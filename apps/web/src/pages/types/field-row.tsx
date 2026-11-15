import { FIELD_PRIMITIVES } from '@liasse/contract/registry';
import { XIcon } from 'lucide-react';
import { Button } from '../../components/ui/button.tsx';
import { Input } from '../../components/ui/input.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.tsx';
import {
  type FieldDraft,
  isFieldPrimitive,
  isScalarPrimitive,
  parameterOf,
  SCALAR_PRIMITIVES,
} from './field-drafts.ts';

interface PrimitiveSelectProps {
  readonly label: string;
  readonly value: string;
  readonly options: readonly string[];
  readonly onChange: (value: string) => void;
}

const PrimitiveSelect = ({ label, value, options, onChange }: PrimitiveSelectProps) => (
  <Select value={value} onValueChange={onChange}>
    <SelectTrigger aria-label={label} className="w-32">
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      {options.map((option) => (
        <SelectItem key={option} value={option}>
          {option}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
);

interface FieldRowProps {
  readonly index: number;
  readonly draft: FieldDraft;
  readonly onChange: (draft: FieldDraft) => void;
  readonly onRemove: () => void;
}

/** One field of a type to create: its name, its primitive and the parameters it takes. */
export const FieldRow = ({ index, draft, onChange, onRemove }: FieldRowProps) => {
  const position = String(index + 1);
  const parameter = parameterOf(draft);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        aria-label={`Name of field ${position}`}
        placeholder="field_name"
        className="w-44 font-mono"
        value={draft.name}
        onChange={(event) => {
          onChange({ ...draft, name: event.target.value });
        }}
      />
      <PrimitiveSelect
        label={`Primitive of field ${position}`}
        value={draft.primitive}
        options={FIELD_PRIMITIVES}
        onChange={(value) => {
          if (isFieldPrimitive(value)) onChange({ ...draft, primitive: value });
        }}
      />
      {draft.primitive === 'list' ? (
        <PrimitiveSelect
          label={`Items of field ${position}`}
          value={draft.items}
          options={SCALAR_PRIMITIVES}
          onChange={(value) => {
            if (isScalarPrimitive(value)) onChange({ ...draft, items: value });
          }}
        />
      ) : null}
      {parameter === 'enum' ? (
        <Input
          aria-label={`Values of field ${position}`}
          placeholder="value_one, value_two"
          className="min-w-44 flex-1"
          value={draft.values}
          onChange={(event) => {
            onChange({ ...draft, values: event.target.value });
          }}
        />
      ) : null}
      {parameter === 'identifier' ? (
        <Input
          aria-label={`Format of field ${position}`}
          placeholder="Format, optional: IBAN"
          className="min-w-44 flex-1"
          value={draft.format}
          onChange={(event) => {
            onChange({ ...draft, format: event.target.value });
          }}
        />
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={`Remove field ${position}`}
        onClick={onRemove}
      >
        <XIcon />
      </Button>
    </div>
  );
};
