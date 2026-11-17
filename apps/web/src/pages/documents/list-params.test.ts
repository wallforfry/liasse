import { describe, expect, it } from 'vitest';
import { MAX_SEARCH_LIMIT } from '@liasse/contract/search';
import {
  listOptions,
  PAGE_SIZE,
  readFilters,
  searchRequest,
  withEntity,
  withFilter,
  withOffset,
} from './list-params.ts';

describe('the filters of a document list', () => {
  it('reads the filters of the address', () => {
    const params = new URLSearchParams('status=needs_review&type=invoice&private=only&offset=50');
    expect(readFilters(params)).toEqual({
      status: 'needs_review',
      type: 'invoice',
      private: 'only',
      offset: 50,
    });
    expect(listOptions(readFilters(params))).toMatchObject({ limit: PAGE_SIZE, offset: 50 });
  });

  it('leaves at their default the filters it cannot read', () => {
    const params = new URLSearchParams('status=deleted&type=&private=all&offset=-3');
    expect(readFilters(params)).toEqual({ private: 'exclude', offset: 0 });
    expect(readFilters(new URLSearchParams('offset=1.5'))).toEqual({
      private: 'exclude',
      offset: 0,
    });
  });

  it('changes or clears one filter and goes back to the first page', () => {
    const params = new URLSearchParams('status=failed&type=invoice&offset=100');
    expect(withFilter(params, 'type', 'bill').toString()).toBe('status=failed&type=bill');
    expect(withFilter(params, 'status', undefined).toString()).toBe('type=invoice');
    expect(params.toString()).toBe('status=failed&type=invoice&offset=100');
  });

  it('moves between pages, the first one without an offset', () => {
    const params = new URLSearchParams('type=invoice&offset=50');
    expect(withOffset(params, 100).toString()).toBe('type=invoice&offset=100');
    expect(withOffset(params, 0).toString()).toBe('type=invoice');
  });

  it('reads a search, trimmed, and leaves a blank one out', () => {
    expect(readFilters(new URLSearchParams('q=%20electricity%20&type=bill'))).toEqual({
      query: 'electricity',
      type: 'bill',
      private: 'exclude',
      offset: 0,
    });
    expect(readFilters(new URLSearchParams('q=%20%20'))).toEqual({ private: 'exclude', offset: 0 });
  });

  it('includes private documents in a search asked to keep only them', () => {
    expect(readFilters(new URLSearchParams('q=gas&private=only')).private).toBe('include');
    expect(readFilters(new URLSearchParams('private=only')).private).toBe('only');
  });

  it('lists without the search and searches with the filters of the list', () => {
    const filters = readFilters(new URLSearchParams('q=gas&status=indexed&type=bill&offset=50'));
    expect(listOptions(filters)).toEqual({
      status: 'indexed',
      type: 'bill',
      private: 'exclude',
      offset: 50,
      limit: PAGE_SIZE,
    });
    expect(searchRequest('gas', filters)).toEqual({
      query: 'gas',
      filters: { status: 'indexed', type: 'bill' },
      limit: MAX_SEARCH_LIMIT,
      include_private: false,
    });
    expect(searchRequest('gas', { ...filters, private: 'include' }).include_private).toBe(true);
  });

  it('filters by the id of an entity and shows its name, or its id without one', () => {
    const params = new URLSearchParams('q=gas&entity=ent_synthetic_volta&entity_name=Volta');
    const filters = readFilters(params);
    expect(filters.entity).toEqual({ id: 'ent_synthetic_volta', name: 'Volta' });
    expect(listOptions(filters).entity).toBe('ent_synthetic_volta');
    expect(searchRequest('gas', filters).filters).toEqual({ entity: 'ent_synthetic_volta' });
    expect(readFilters(new URLSearchParams('entity=ent_synthetic_volta')).entity).toEqual({
      id: 'ent_synthetic_volta',
      name: 'ent_synthetic_volta',
    });
    expect(readFilters(new URLSearchParams('entity=&entity_name=Volta')).entity).toBeUndefined();
  });

  it('changes or clears the entity with its name, back on the first page', () => {
    const params = new URLSearchParams('type=bill&offset=50');
    const chosen = withEntity(params, { id: 'ent_synthetic_volta', name: 'Volta Énergie' });
    expect(readFilters(chosen)).toEqual({
      type: 'bill',
      entity: { id: 'ent_synthetic_volta', name: 'Volta Énergie' },
      private: 'exclude',
      offset: 0,
    });
    expect(withEntity(chosen, undefined).toString()).toBe('type=bill');
  });
});
