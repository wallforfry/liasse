import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert.tsx';

export const CorrectionProblems = ({ problems }: { readonly problems: readonly string[] }) =>
  problems.length === 0 ? null : (
    <Alert variant="destructive">
      <AlertTitle>The correction was not saved</AlertTitle>
      <AlertDescription>
        <ul className="list-inside list-disc">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
