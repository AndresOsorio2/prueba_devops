const {
  parsePagination,
  parseOffsetLimit,
  PAGINATION_DEFAULT_PAGE,
  PAGINATION_DEFAULT_LIMIT,
  PAGINATION_MAX_LIMIT,
  EVENTS_DEFAULT_LIMIT
} = require('../../src/utils/pagination');

describe('pagination constants', () => {
  test('expose the exact limits the controllers had hardcoded', () => {
    expect(PAGINATION_DEFAULT_PAGE).toBe(1);
    expect(PAGINATION_DEFAULT_LIMIT).toBe(10);
    expect(PAGINATION_MAX_LIMIT).toBe(100);
    expect(EVENTS_DEFAULT_LIMIT).toBe(50);
  });
});

describe('parsePagination', () => {
  test('disables pagination when the query has no page nor limit key', () => {
    expect(parsePagination({})).toEqual({ enabled: false, page: 1, limit: 10 });
  });

  test('falls back to the defaults for an empty query', () => {
    expect(parsePagination({ search: 'abc' })).toEqual({ enabled: false, page: 1, limit: 10 });
  });

  test('enables pagination when only the limit key is present', () => {
    expect(parsePagination({ limit: '25' })).toEqual({ enabled: true, page: 1, limit: 25 });
  });

  test('enables pagination when only the page key is present', () => {
    expect(parsePagination({ page: '3' })).toEqual({ enabled: true, page: 3, limit: 10 });
  });

  test('parses numeric strings', () => {
    expect(parsePagination({ page: '2', limit: '5' })).toEqual({ enabled: true, page: 2, limit: 5 });
  });

  test('accepts real numbers, not only strings', () => {
    expect(parsePagination({ page: 4, limit: 6 })).toEqual({ enabled: true, page: 4, limit: 6 });
  });

  test('clamps a page below 1 to the default page', () => {
    expect(parsePagination({ page: '0' }).page).toBe(1);
    expect(parsePagination({ page: '-5' }).page).toBe(1);
  });

  test('clamps a limit below 1 to the default limit', () => {
    expect(parsePagination({ limit: '0' }).limit).toBe(10);
    expect(parsePagination({ limit: '-3' }).limit).toBe(10);
  });

  test('caps the limit at the maximum', () => {
    expect(parsePagination({ limit: '500' }).limit).toBe(100);
    expect(parsePagination({ limit: 1000 }).limit).toBe(100);
  });

  test('keeps a limit exactly at the maximum', () => {
    expect(parsePagination({ limit: '100' }).limit).toBe(100);
  });

  test('does not cap the page', () => {
    expect(parsePagination({ page: '999' }).page).toBe(999);
  });

  test('keeps pagination enabled when the key is present with a non-numeric value', () => {
    expect(parsePagination({ page: 'abc' })).toEqual({ enabled: true, page: 1, limit: 10 });
    expect(parsePagination({ limit: 'abc' })).toEqual({ enabled: true, page: 1, limit: 10 });
  });

  test('keeps pagination enabled when the key is present but empty', () => {
    expect(parsePagination({ page: '' })).toEqual({ enabled: true, page: 1, limit: 10 });
    expect(parsePagination({ limit: '' })).toEqual({ enabled: true, page: 1, limit: 10 });
  });

  test('does not clamp a decimal limit, because parseInt truncates it', () => {
    expect(parsePagination({ limit: '7.9' }).limit).toBe(7);
  });
});

describe('parseOffsetLimit', () => {
  test('applies the event defaults when nothing is given', () => {
    expect(parseOffsetLimit({})).toEqual({ limit: 50, offset: 0 });
  });

  test('applies the defaults per key independently', () => {
    expect(parseOffsetLimit({ limit: '20' })).toEqual({ limit: '20', offset: 0 });
    expect(parseOffsetLimit({ offset: '40' })).toEqual({ limit: 50, offset: '40' });
  });

  test('returns both values untouched when both are given', () => {
    expect(parseOffsetLimit({ limit: '20', offset: '40' })).toEqual({ limit: '20', offset: '40' });
  });

  test('does not coerce to a number: coercion stays with the call site', () => {
    expect(parseOffsetLimit({ limit: 'abc' }).limit).toBe('abc');
  });

  test('does not cap the limit: the events service has no maximum', () => {
    expect(parseOffsetLimit({ limit: '5000' }).limit).toBe('5000');
  });

  test('is not the same contract as parsePagination: no page, no skip', () => {
    const result = parseOffsetLimit({ limit: '20', offset: '40' });

    expect(result).not.toHaveProperty('page');
    expect(result).not.toHaveProperty('enabled');
  });
});
