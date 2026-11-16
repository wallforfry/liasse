import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert.tsx';

export const CorrectionProblems = ({
  title,
  problems,
}: {
  readonly title: string;
  readonly problems: readonly string[];
}) =>
  problems.length === 0 ? null : (
    <Alert variant="destructive">
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <ul className="list-inside list-disc">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
