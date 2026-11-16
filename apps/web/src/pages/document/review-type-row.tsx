import { MAX_HINT_LENGTH } from '@liasse/contract/domain';
import type { DocumentReview } from '@liasse/sdk';
import { Label } from '../../components/ui/label.tsx';
import { Textarea } from '../../components/ui/textarea.tsx';
import { confidenceLabel, type ReviewDraft } from './review.ts';
import { type Choice, ChoiceGroup } from './review-choice.tsx';
import { TypePicker } from './type-picker.tsx';

type TypeChoice = 'accept' | 'change' | 'reanalyse';

const TYPE_CHOICES: readonly Choice<TypeChoice>[] = [
  { value: 'accept', label: 'Accept' },
  { value: 'change', label: 'Change' },
  { value: 'reanalyse', label: 'Analyse again' },
];

type TypeDraft = Pick<ReviewDraft, 'type' | 'reanalysis'>;

const choiceOf = (current: string | null, { type, reanalysis }: TypeDraft): TypeChoice => {
  if (reanalysis !== null) return 'reanalyse';
  return current === null || type !== current ? 'change' : 'accept';
};

const draftOf = (current: string | null, choice: TypeChoice): TypeDraft => {
  if (choice === 'reanalyse') return { type: current ?? '', reanalysis: '' };
  return { type: choice === 'accept' ? (current ?? '') : '', reanalysis: null };
};

const ReanalysisHint = ({
  hint,
  onChange,
}: {
  readonly hint: string;
  readonly onChange: (hint: string) => void;
}) => (
  <div className="grid max-w-md gap-2">
    <Label htmlFor="review-reanalysis-hint">What the document is (optional)</Label>
    <Textarea
      id="review-reanalysis-hint"
      placeholder="For example: a water bill, not an electricity bill"
      maxLength={MAX_HINT_LENGTH}
      value={hint}
      onChange={(event) => {
        onChange(event.target.value);
      }}
    />
    <p className="text-sm text-muted-foreground">
      The model decides the type again without the current one, and creates a new type when none
      fits. The values are then read again for that type.
    </p>
  </div>
);

export const TypeRow = ({
  current,
  type,
  draft,
  onChange,
}: {
  /** The slug of the type the document has, null for an untyped one. */
  readonly current: string | null;
  readonly type: DocumentReview['type'];
  readonly draft: TypeDraft;
  readonly onChange: (draft: TypeDraft) => void;
}) => {
  const choice = choiceOf(current, draft);
  return (
    <div className="flex flex-col gap-2 border-b pb-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium">Type: {current ?? 'untyped'}</p>
          <p className="text-sm text-muted-foreground">
            {type.manual ? 'chosen by hand' : confidenceLabel(type.confidence)}
          </p>
        </div>
        <ChoiceGroup
          label="Decision for the type"
          choices={TYPE_CHOICES.filter(({ value }) => current !== null || value !== 'accept')}
          value={choice}
          onChange={(next) => {
            onChange(draftOf(current, next));
          }}
        />
      </div>
      {choice === 'change' ? (
        <div className="grid max-w-md gap-2">
          <Label htmlFor="review-type">Type</Label>
          <TypePicker
            id="review-type"
            value={draft.type}
            onChange={(slug) => {
              onChange({ type: slug, reanalysis: null });
            }}
          />
        </div>
      ) : null}
      {draft.reanalysis === null ? null : (
        <ReanalysisHint
          hint={draft.reanalysis}
          onChange={(hint) => {
            onChange({ ...draft, reanalysis: hint });
          }}
        />
      )}
    </div>
  );
};
