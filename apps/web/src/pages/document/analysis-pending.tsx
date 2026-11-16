import { LoaderCircleIcon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert.tsx';

/** Shown while a job is about to rewrite the type or the values of the document. */
export const AnalysisPending = () => (
  <Alert role="status">
    <LoaderCircleIcon className="animate-spin" />
    <AlertTitle>The document is being analysed again</AlertTitle>
    <AlertDescription>
      Its type and values are about to change: the model is reading it again, which can take a
      minute or two. This page follows it, and you can leave it meanwhile.
    </AlertDescription>
  </Alert>
);
