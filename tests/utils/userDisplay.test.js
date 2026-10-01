const {
  PROFILE_FIELDS,
  PROFILE_LIMITS,
  normalizeProfileValue,
  fullNameOf,
  profileJoiSchema
} = require('../../src/utils/userDisplay');

describe('userDisplay contract', () => {
  test('exposes exactly the three profile fields and their limits', () => {
    expect(PROFILE_FIELDS).toEqual(['firstName', 'lastName', 'jobTitle']);
    expect(PROFILE_LIMITS).toEqual({ firstName: 60, lastName: 60, jobTitle: 120 });
  });

  test.each([
    ['firstName', 60],
    ['lastName', 60],
    ['jobTitle', 120]
  ])('accepts a %s of exactly the maximum length', (field, limit) => {
    const { error } = profileJoiSchema().validate({ [field]: 'x'.repeat(limit) });
    expect(error).toBeUndefined();
  });

  test('treats every profile field as optional', () => {
    expect(profileJoiSchema().validate({}).error).toBeUndefined();
  });

  test.each(PROFILE_FIELDS)('rejects a non-string %s', (field) => {
    const { error } = profileJoiSchema().validate({ [field]: 42 });
    expect(error).toBeDefined();
  });
});

describe('normalizeProfileValue', () => {
  test('trims surrounding whitespace', () => {
    expect(normalizeProfileValue('  Ana  ')).toBe('Ana');
  });

  test.each([
    ['an empty string', ''],
    ['a blank string', '   '],
    ['null', null],
    ['undefined', undefined]
  ])('maps %s to null so the field can be cleared', (_label, input) => {
    expect(normalizeProfileValue(input)).toBeNull();
  });

  test('keeps an inner space, as job titles rely on it', () => {
    expect(normalizeProfileValue('  Software  Architect  ')).toBe('Software  Architect');
  });
});

describe('fullNameOf', () => {
  test('joins first and last name', () => {
    expect(fullNameOf({ firstName: 'Ana', lastName: 'Ruiz', email: 'ana@softwareone.com' }))
      .toBe('Ana Ruiz');
  });

  test('falls back to the first name when there is no last name', () => {
    expect(fullNameOf({ firstName: 'Ana', lastName: null, email: 'ana@softwareone.com' }))
      .toBe('Ana');
  });

  test('falls back to the last name when there is no first name', () => {
    expect(fullNameOf({ firstName: null, lastName: 'Ruiz', email: 'ana@softwareone.com' }))
      .toBe('Ruiz');
  });

  test('falls back to the email when the user has no name at all', () => {
    expect(fullNameOf({ firstName: null, lastName: null, email: 'ana@softwareone.com' }))
      .toBe('ana@softwareone.com');
  });

  test('ignores whitespace-only names instead of rendering a blank name', () => {
    expect(fullNameOf({ firstName: '   ', lastName: '\t', email: 'ana@softwareone.com' }))
      .toBe('ana@softwareone.com');
  });

  test('does not coerce a non-string name into the output', () => {
    expect(fullNameOf({ firstName: 123, lastName: null, email: 'ana@softwareone.com' }))
      .toBe('ana@softwareone.com');
  });

  test.each([
    ['a null user', null],
    ['an undefined user', undefined]
  ])('returns null for %s', (_label, input) => {
    expect(fullNameOf(input)).toBeNull();
  });

  test('returns null when there is neither a name nor an email to fall back to', () => {
    expect(fullNameOf({ firstName: null, lastName: null })).toBeNull();
  });

  test('reads the fields off a plain object, which is what the toJSON transform receives', () => {
    const ret = { _id: '1', email: 'ana@softwareone.com', firstName: 'Ana', lastName: 'Ruiz' };
    expect(fullNameOf(ret)).toBe('Ana Ruiz');
  });
});