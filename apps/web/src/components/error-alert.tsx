import { CircleAlertIcon } from 'lucide-react';
import { errorMessage } from '../api/errors.ts';
import { Alert, AlertDescription, AlertTitle } from './ui/alert.tsx';

export const ErrorAlert = ({
  error,
  title = 'Something went wrong',
}: {
  readonly error: unknown;
  readonly title?: string;
}) => (
  <Alert variant="destructive">
    <CircleAlertIcon />
    <AlertTitle>{title}</AlertTitle>
    <AlertDescription>{errorMessage(error)}</AlertDescription>
  </Alert>
);
