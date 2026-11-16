import type { DocumentView } from '@liasse/sdk';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card.tsx';
import { ManualType } from './manual-type.tsx';
import { PrivacySection } from './privacy-section.tsx';
import { ValuesCard } from './values-card.tsx';

/**
 * The edit tab of a document: its type, its values and its privacy, each saved on its own.
 * A form gets a new key once the document is read again, which resets it to what it has.
 * A new analysis of the type is asked for from the review of a flagged document.
 */
export const EditTab = ({ document }: { readonly document: DocumentView }) => (
  <div className="flex max-w-3xl flex-col gap-4">
    <Card>
      <CardHeader>
        <CardTitle>Type</CardTitle>
        <CardDescription>
          {document.type === null
            ? 'The document has no type yet.'
            : `The document is of type ${document.type}.`}{' '}
          If that is wrong, choose the right type by hand.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ManualType key={document.updated_at} document={document} />
      </CardContent>
    </Card>
    <ValuesCard key={`values-${document.updated_at}`} document={document} />
    <PrivacySection key={`privacy-${document.updated_at}`} document={document} />
  </div>
);
