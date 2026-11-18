import { useSearchParams } from 'react-router';
import { PageHeader } from '../../components/page-header.tsx';
import { DocumentFilters } from './document-filters.tsx';
import { DocumentListResults } from './document-list-results.tsx';
import { DocumentSearchBox } from './document-search-box.tsx';
import { DocumentSearchResults } from './document-search-results.tsx';
import {
  type DocumentStatus,
  readFilters,
  withEntity,
  withFilter,
  withOffset,
} from './list-params.ts';
import { MissingEntityNotice } from './missing-entity-notice.tsx';
import { useMissingEntity } from './use-missing-entity.ts';

export interface DocumentListPageProps {
  readonly title: string;
  readonly description: string;
  /** Fixed by the page, as the review queue does; the person picks it otherwise. */
  readonly status?: DocumentStatus;
}

export const DocumentListPage = ({ title, description, status }: DocumentListPageProps) => {
  const [params, setParams] = useSearchParams();
  const read = readFilters(params);
  const filters = status === undefined ? read : { ...read, status };
  const missingEntity = useMissingEntity(filters.entity);

  return (
    <>
      <PageHeader title={title} description={description} />
      {/* A new address, such as a search from the command palette, starts the box again. */}
      <DocumentSearchBox
        key={filters.query ?? ''}
        query={filters.query}
        onSearch={(query) => {
          setParams(withFilter(params, 'q', query));
        }}
      />
      <DocumentFilters
        filters={filters}
        statusFilter={status === undefined}
        onChange={(name, value) => {
          setParams(withFilter(params, name, value));
        }}
        onEntityChange={(entity) => {
          setParams(withEntity(params, entity));
        }}
      />
      {missingEntity !== undefined ? (
        <MissingEntityNotice
          entity={missingEntity}
          onClear={() => {
            setParams(withEntity(params, undefined));
          }}
        />
      ) : filters.query === undefined ? (
        <DocumentListResults
          filters={filters}
          onOffset={(offset) => {
            setParams(withOffset(params, offset));
          }}
        />
      ) : (
        <DocumentSearchResults query={filters.query} filters={filters} />
      )}
    </>
  );
};
