const {
  DEFAULT_ALLOWED_DOMAINS,
  parseAllowedEmailDomains,
  isEmailAllowed
} = require('../../src/services/domainService');

describe('DEFAULT_ALLOWED_DOMAINS', () => {
  test('defaults to softwareone.com', () => {
    expect(DEFAULT_ALLOWED_DOMAINS).toEqual(['softwareone.com']);
  });
});

describe('parseAllowedEmailDomains', () => {
  test('returns the default list when the raw value is undefined or null', () => {
    expect(parseAllowedEmailDomains(undefined)).toEqual(['softwareone.com']);
    expect(parseAllowedEmailDomains(null)).toEqual(['softwareone.com']);
  });

  test('splits by comma, trims and lowercases each domain', () => {
    expect(parseAllowedEmailDomains(' SoftwareOne.COM , other.com ')).toEqual([
      'softwareone.com',
      'other.com'
    ]);
  });

  test('returns an empty list for an explicitly empty value', () => {
    expect(parseAllowedEmailDomains('')).toEqual([]);
    expect(parseAllowedEmailDomains('   ,  ')).toEqual([]);
  });
});

describe('isEmailAllowed', () => {
  test('allows an exact domain match', () => {
    expect(isEmailAllowed('user@softwareone.com', 'softwareone.com')).toBe(true);
  });

  test('is case-insensitive for the email domain and the config', () => {
    expect(isEmailAllowed('User@SOFTWAREONE.COM', 'softwareone.com')).toBe(true);
    expect(isEmailAllowed('User@Test.com', 'TEST.COM')).toBe(true);
    expect(isEmailAllowed('User@sub.softwareone.com', 'softwareone.com')).toBe(false);
  });

  test('rejects a different or subdomain value', () => {
    expect(isEmailAllowed('user@other.com', 'softwareone.com')).toBe(false);
    expect(isEmailAllowed('user@sub.softwareone.com', 'softwareone.com')).toBe(false);
  });

  test('supports a comma separated list of allowed domains', () => {
    expect(isEmailAllowed('user@other.com', 'softwareone.com, other.com')).toBe(true);
  });

  test('falls back to the default when the raw value is undefined', () => {
    expect(isEmailAllowed('user@softwareone.com', undefined)).toBe(true);
    expect(isEmailAllowed('user@other.com', undefined)).toBe(false);
  });

  test('rejects every domain when the configured value is empty', () => {
    expect(isEmailAllowed('user@softwareone.com', '')).toBe(false);
  });
});