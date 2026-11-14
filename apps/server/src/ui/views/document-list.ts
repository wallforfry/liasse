import { type DocumentList, PRIVATE_FILTERS, type PrivateFilter } from '@liasse/core/api';
import { liveDocumentStatusSchema } from '@liasse/core/domain';
import { html } from 'hono/html';
import { documentPath, formatTime, type Markup } from '../markup.ts';

export interface ListFilters {
  readonly status?: string | undefined;
  readonly private: PrivateFilter;
  readonly offset: number;
  readonly limit: number;
}

export interface DocumentListView {
  /** Where the filters and the pages of this list are read. */
  readonly path: string;
  readonly list: DocumentList;
  readonly filters: ListFilters;
  /** False when the page fixes the status itself, as the review queue does. */
  readonly statusFilter: boolean;
}

const PRIVATE_LABELS: Readonly<Record<PrivateFilter, string>> = {
  exclude: 'Leave private documents out',
  include: 'Include private documents',
  only: 'Private documents only',
};

const option = (value: string, label: string, selected: boolean): Markup =>
  html`<option value="${value}" ${selected ? html`selected` : ''}>${label}</option>`;

const filterForm = ({ path, filters, statusFilter }: DocumentListView): Markup =>
  html`<form method="get" action="${path}" class="filters">
    ${
      statusFilter
        ? html`<label
            >Status
            <select name="status">
              ${option('', 'Any', filters.status === undefined)}
              ${liveDocumentStatusSchema.options.map((status) =>
                option(status, status, filters.status === status),
              )}
            </select></label
          >`
        : ''
    }
    <label
      >Private documents
      <select name="private">
        ${PRIVATE_FILTERS.map((value) =>
          option(value, PRIVATE_LABELS[value], filters.private === value),
        )}
      </select></label
    >
    <button type="submit">Filter</button>
  </form>`;

const pageLink = (view: DocumentListView, offset: number, label: string): Markup => {
  const query = new URLSearchParams({
    ...(view.statusFilter && view.filters.status !== undefined
      ? { status: view.filters.status }
      : {}),
    private: view.filters.private,
    offset: String(offset),
  });
  return html`<a href="${`${view.path}?${query.toString()}`}">${label}</a>`;
};

const pager = (view: DocumentListView): Markup => {
  const { offset, limit } = view.filters;
  return html`<p class="pager">
    ${offset > 0 ? pageLink(view, Math.max(0, offset - limit), 'Previous') : ''}
    ${view.list.has_more ? pageLink(view, offset + limit, 'Next') : ''}
  </p>`;
};

const rows = (list: DocumentList): readonly Markup[] =>
  list.documents.map(
    (document) =>
      html`<tr>
        <td>
          <a href="${documentPath(document.id)}">${document.title ?? document.original_name}</a>
        </td>
        <td>${document.type ?? html`<span class="muted">untyped</span>`}</td>
        <td>${document.status}</td>
        <td>${document.private ? 'private' : ''}</td>
        <td>${formatTime(document.ingested_at)}</td>
      </tr>`,
  );

export const documentListView = (view: DocumentListView): Markup =>
  html`${filterForm(view)}
    <p class="muted">${view.list.total} document${view.list.total === 1 ? '' : 's'}</p>
    ${
      view.list.documents.length === 0
        ? html`<p>No document matches.</p>`
        : html`<table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Type</th>
                <th>Status</th>
                <th>Privacy</th>
                <th>Ingested</th>
              </tr>
            </thead>
            <tbody>
              ${rows(view.list)}
            </tbody>
          </table>`
    }
    ${pager(view)}`;
