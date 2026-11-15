import { Link } from 'react-router';
import { PageHeader } from '../components/page-header.tsx';
import { Button } from '../components/ui/button.tsx';

export const NotFoundPage = () => (
  <>
    <PageHeader title="Not found" description="No page of Liasse lives at this address." />
    <div>
      <Button asChild variant="outline">
        <Link to="/documents">Back to the documents</Link>
      </Button>
    </div>
  </>
);
