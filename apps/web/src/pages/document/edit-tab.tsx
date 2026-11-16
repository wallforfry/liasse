import type { DocumentView } from '@liasse/sdk';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card.tsx';
import { Separator } from '../../components/ui/separator.tsx';
import { ManualType } from './manual-type.tsx';
import { PrivacySection } from './privacy-section.tsx';
import { ReclassifyType } from './reclassify-type.tsx';
import { ValuesCard } from './values-card.tsx';

/**
 * The edit tab of a document: its type, its values and its privacy, each saved on its own.
 * A form gets a new key once the document is read again, which resets it to what it has;
 * the reclassification keeps none, so that it follows its analysis to the end.
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
          If that is wrong, choose the right type by hand, or let the model analyse it again.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ManualType key={document.updated_at} document={document} />
        <Separator />
        <ReclassifyType document={document} />
      </CardContent>
    </Card>
    <ValuesCard key={`values-${document.updated_at}`} document={document} />
    <PrivacySection key={`privacy-${document.updated_at}`} document={document} />
  </div>
);
