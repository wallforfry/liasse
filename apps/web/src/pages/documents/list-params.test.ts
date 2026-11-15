import { describe, expect, it } from 'vitest';
import { listOptions, PAGE_SIZE, readFilters, withFilter, withOffset } from './list-params.ts';

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
});
