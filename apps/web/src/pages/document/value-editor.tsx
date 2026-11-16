import { Checkbox } from '../../components/ui/checkbox.tsx';
import { Input } from '../../components/ui/input.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.tsx';
import { Textarea } from '../../components/ui/textarea.tsx';
import type { ValueDraft, ValueEditor as Editor } from './value-drafts.ts';

interface ValueEditorProps {
  readonly id: string;
  readonly name: string;
  readonly editor: Editor;
  readonly draft: ValueDraft;
  readonly onChange: (draft: ValueDraft) => void;
}

const SingleEditor = ({
  id,
  editor,
  text,
  onChange,
}: Pick<ValueEditorProps, 'id' | 'editor'> & {
  readonly text: string;
  readonly onChange: (text: string) => void;
}) => {
  switch (editor.kind) {
    case 'enum':
      return (
        <Select value={text === '' ? undefined : text} onValueChange={onChange}>
          <SelectTrigger id={id} className="w-full sm:w-64">
            <SelectValue placeholder="No value" />
          </SelectTrigger>
          <SelectContent>
            {editor.values.map((value) => (
              <SelectItem key={value} value={value}>
                {value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case 'boolean':
      return (
        <div className="flex h-9 items-center gap-2">
          <Checkbox
            id={id}
            checked={text === 'true'}
            onCheckedChange={(checked) => {
              onChange(checked === true ? 'true' : 'false');
            }}
          />
          <span className="text-sm text-muted-foreground">
            {text === '' ? 'No value' : text === 'true' ? 'Yes' : 'No'}
          </span>
        </div>
      );
    case 'json':
      return (
        <Textarea
          id={id}
          className="min-h-24 font-mono text-xs"
          value={text}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
      );
    case 'text':
    case 'number':
    case 'date':
    case 'money':
    case 'period':
      return (
        <Input
          id={id}
          type={editor.kind === 'number' || editor.kind === 'date' ? editor.kind : 'text'}
          step={editor.kind === 'number' ? 'any' : undefined}
          className={editor.kind === 'text' ? undefined : 'w-full sm:w-64'}
          value={text}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
      );
  }
};

/** The input of one value, chosen by its editor: always as text, never as markup. */
export const ValueEditor = ({ id, name, editor, draft, onChange }: ValueEditorProps) => {
  switch (draft.kind) {
    case 'money':
      return (
        <div className="flex gap-2">
          <Input
            id={id}
            type="number"
            step="any"
            aria-label={`${name}, amount`}
            className="w-40"
            value={draft.amount}
            onChange={(event) => {
              onChange({ ...draft, amount: event.target.value });
            }}
          />
          <Input
            aria-label={`${name}, currency`}
            placeholder="EUR"
            maxLength={3}
            className="w-20 uppercase"
            value={draft.currency}
            onChange={(event) => {
              onChange({ ...draft, currency: event.target.value });
            }}
          />
        </div>
      );
    case 'period':
      return (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            id={id}
            type="date"
            aria-label={`${name}, start`}
            className="w-44"
            value={draft.start}
            onChange={(event) => {
              onChange({ ...draft, start: event.target.value });
            }}
          />
          <span className="text-sm text-muted-foreground">to</span>
          <Input
            type="date"
            aria-label={`${name}, end`}
            className="w-44"
            value={draft.end}
            onChange={(event) => {
              onChange({ ...draft, end: event.target.value });
            }}
          />
        </div>
      );
    case 'single':
      return (
        <SingleEditor
          id={id}
          editor={editor}
          text={draft.text}
          onChange={(text) => {
            onChange({ kind: 'single', text });
          }}
        />
      );
  }
};
