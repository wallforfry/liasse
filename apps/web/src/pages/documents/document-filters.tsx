import { PRIVATE_FILTERS, type PrivateFilter } from '@liasse/contract';
import { useQuery } from '@tanstack/react-query';
import { useClient } from '../../api/session.ts';
import { statusLabel } from '../../lib/format.ts';
import { Label } from '../../components/ui/label.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.tsx';
import { DOCUMENT_STATUSES, type ListFilters, type ListParam } from './list-params.ts';

// Radix refuses an empty value for an item: this one stands for no filter.
const ANY = 'any';

const PRIVATE_LABELS: Readonly<Record<PrivateFilter, string>> = {
  exclude: 'Leave private out',
  include: 'Include private',
  only: 'Private only',
};

type Option = readonly [value: string, label: string];

export interface DocumentFiltersProps {
  readonly filters: ListFilters;
  /** False when the page fixes the status itself, as the review queue does. */
  readonly statusFilter: boolean;
  /** Undefined clears the filter. */
  readonly onChange: (name: ListParam, value: string | undefined) => void;
}

interface FilterSelectProps {
  readonly name: ListParam;
  readonly label: string;
  readonly value: string;
  readonly options: readonly Option[];
  readonly onChange: DocumentFiltersProps['onChange'];
}

const FilterSelect = ({ name, label, value, options, onChange }: FilterSelectProps) => (
  <div className="grid gap-1.5">
    <Label htmlFor={`filter-${name}`} className="text-xs text-muted-foreground">
      {label}
    </Label>
    <Select
      value={value}
      onValueChange={(next) => {
        onChange(name, next === ANY ? undefined : next);
      }}
    >
      <SelectTrigger id={`filter-${name}`} className="w-44">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(([optionValue, optionLabel]) => (
          <SelectItem key={optionValue} value={optionValue}>
            {optionLabel}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  </div>
);

const STATUS_OPTIONS: readonly Option[] = [
  [ANY, 'Any status'],
  ...DOCUMENT_STATUSES.map((status): Option => [status, statusLabel(status)]),
];

const PRIVATE_OPTIONS: readonly Option[] = PRIVATE_FILTERS.map((filter): Option => [
  filter,
  PRIVATE_LABELS[filter],
]);

export const DocumentFilters = ({ filters, statusFilter, onChange }: DocumentFiltersProps) => {
  const client = useClient();
  const types = useQuery({ queryKey: ['types'], queryFn: async () => client.listTypes() });
  const typeOptions: readonly Option[] = [
    [ANY, 'Any type'],
    ...(types.data?.types ?? []).map(({ slug }): Option => [slug, slug]),
  ];
  return (
    <div className="flex flex-wrap items-end gap-3">
      {statusFilter ? (
        <FilterSelect
          name="status"
          label="Status"
          value={filters.status ?? ANY}
          options={STATUS_OPTIONS}
          onChange={onChange}
        />
      ) : null}
      <FilterSelect
        name="type"
        label="Type"
        value={filters.type ?? ANY}
        options={typeOptions}
        onChange={onChange}
      />
      <FilterSelect
        name="private"
        label="Privacy"
        value={filters.private}
        options={PRIVATE_OPTIONS}
        onChange={onChange}
      />
    </div>
  );
};
