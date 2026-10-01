jest.mock('../../src/models/User', () => require('../mocks/mongooseModel')());
jest.mock('../../src/services/passwordService', () => {
  const actual = jest.requireActual('../../src/services/passwordService');
  return {
    hashPassword: jest.fn(),
    validatePasswordPolicy: jest.fn(),
    PasswordPolicyError: actual.PasswordPolicyError
  };
});
jest.mock('../../src/services/domainService', () => ({
  isEmailAllowed: jest.fn()
}));
jest.mock('../../src/services/eventSourcingService', () => ({
  createEvent: jest.fn()
}));
jest.mock('../../src/logger/seqLogger', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));

const User = require('../../src/models/User');
const { hashPassword, validatePasswordPolicy, PasswordPolicyError } = require('../../src/services/passwordService');
const { isEmailAllowed } = require('../../src/services/domainService');
const { createEvent } = require('../../src/services/eventSourcingService');
const logger = require('../../src/logger/seqLogger');
const { importUsers, normalizeEmail } = require('../../src/services/userImportService');

function buildRows() {
  return { email: 'a@softwareone.com', password: 'Temporal1', permissions: ['project:read'] };
}

beforeEach(() => {
  jest.clearAllMocks();
  User.create = jest.fn();
  User.find.mockResolvedValue([]);
  isEmailAllowed.mockReturnValue(true);
  validatePasswordPolicy.mockImplementation(() => {});
  hashPassword.mockResolvedValue('$2b$10$hash');
  createEvent.mockResolvedValue({});
});

describe('normalizeEmail', () => {
  test('trims and lowercases the email', () => {
    expect(normalizeEmail('  User@SoftwareOne.COM  ')).toBe('user@softwareone.com');
  });
});

describe('importUsers with profile metadata', () => {
  test('persists the three profile fields when the row carries them', async () => {
    const result = await importUsers([{
      ...buildRows(),
      firstName: 'Ana',
      lastName: 'Ruiz',
      jobTitle: 'Software Architect'
    }]);

    expect(result).toEqual({ created: 1, rejected: [] });
    expect(User.create).toHaveBeenCalledWith(expect.objectContaining({
      firstName: 'Ana',
      lastName: 'Ruiz',
      jobTitle: 'Software Architect'
    }));
  });

  test('normalizes a blank profile value to null instead of persisting whitespace', async () => {
    await importUsers([{ ...buildRows(), firstName: '  ', jobTitle: '' }]);

    expect(User.create).toHaveBeenCalledWith(expect.objectContaining({
      firstName: null,
      jobTitle: null
    }));
  });

  test('imports a row without profile fields as before', async () => {
    const result = await importUsers([buildRows()]);

    expect(result).toEqual({ created: 1, rejected: [] });
    expect(User.create).toHaveBeenCalledWith(expect.objectContaining({
      firstName: null,
      lastName: null,
      jobTitle: null
    }));
  });

  test('rejects the row when a profile field exceeds its limit', async () => {
    const result = await importUsers([{ ...buildRows(), jobTitle: 'x'.repeat(121) }]);

    expect(result.created).toBe(0);
    expect(result.rejected).toHaveLength(1);
    expect(User.create).not.toHaveBeenCalled();
  });

  test('rejects the row when a profile field is not a string', async () => {
    const result = await importUsers([{ ...buildRows(), firstName: 42 }]);

    expect(result.created).toBe(0);
    expect(User.create).not.toHaveBeenCalled();
  });
});

describe('importUsers', () => {
  test('returns an empty summary for an empty or missing batch without touching the DB', async () => {
    await expect(importUsers([])).resolves.toEqual({ created: 0, rejected: [] });
    await expect(importUsers(undefined)).resolves.toEqual({ created: 0, rejected: [] });
    expect(User.find).not.toHaveBeenCalled();
  });

  test('prefetches existing emails with a single $in query over normalized emails', async () => {
    await importUsers([
      { email: 'A@SoftwareOne.COM', password: 'Temporal1' },
      { email: 'a@softwareone.com', password: 'Temporal2' },
      { email: 'B@softwareone.com', password: 'Temporal3' }
    ]);

    expect(User.find).toHaveBeenCalledTimes(1);
    expect(User.find).toHaveBeenCalledWith(expect.objectContaining({
      email: expect.objectContaining({
        $in: expect.arrayContaining(['a@softwareone.com', 'b@softwareone.com'])
      })
    }));
  });

  test('creates a valid row with hashed password and server-controlled flags', async () => {
    const result = await importUsers([buildRows()]);

    expect(hashPassword).toHaveBeenCalledWith('Temporal1');
    expect(User.create).toHaveBeenCalledWith(expect.objectContaining({
      email: 'a@softwareone.com',
      passwordHash: '$2b$10$hash',
      permissions: ['project:read'],
      active: true,
      mustChangePassword: true
    }));
    expect(result).toEqual({ created: 1, rejected: [] });
    expect(createEvent).toHaveBeenCalledWith('user_created', expect.objectContaining({ email: 'a@softwareone.com' }), {});
  });

  test('emits a user_created event per created row with the persisted id', async () => {
    User.create.mockResolvedValue({ _id: 'real-user-1', email: 'a@softwareone.com' });

    const result = await importUsers([buildRows(), { email: 'b@softwareone.com', password: 'Temporal1' }]);

    expect(result.created).toBe(2);
    expect(createEvent).toHaveBeenCalledTimes(2);
    expect(createEvent).toHaveBeenNthCalledWith(1, 'user_created', { userId: 'real-user-1', email: 'a@softwareone.com' }, {});
    expect(createEvent).toHaveBeenNthCalledWith(2, 'user_created', { userId: expect.any(String), email: 'b@softwareone.com' }, {});
  });

  test('does not emit user_created for rejected rows', async () => {
    await importUsers([
      { email: 'a@softwareone.com', password: 'Temporal1' },
      { email: 'not-an-email', password: 'Temporal1' }
    ]);

    expect(createEvent).toHaveBeenCalledTimes(1);
  });

  test('persists valid permissions from the row', async () => {
    await importUsers([{ email: 'a@softwareone.com', password: 'Temporal1', permissions: ['document:read'] }]);

    expect(User.create).toHaveBeenCalledWith(expect.objectContaining({ permissions: ['document:read'] }));
  });

  test('rejects a row whose email is not valid with VALIDATION_ERROR', async () => {
    const result = await importUsers([{ email: 'not-an-email', password: 'Temporal1' }]);

    expect(result).toEqual({ created: 0, rejected: [{ row: 0, reason: 'VALIDATION_ERROR' }] });
    expect(User.create).not.toHaveBeenCalled();
  });

  test('rejects a row missing email or password with VALIDATION_ERROR', async () => {
    const missingEmail = await importUsers([{ password: 'Temporal1' }]);
    const missingPassword = await importUsers([{ email: 'a@softwareone.com' }]);

    expect(missingEmail.rejected).toEqual([{ row: 0, reason: 'VALIDATION_ERROR' }]);
    expect(missingPassword.rejected).toEqual([{ row: 0, reason: 'VALIDATION_ERROR' }]);
    expect(User.create).not.toHaveBeenCalled();
  });

  test('rejects a row with permissions outside the catalog with VALIDATION_ERROR', async () => {
    const result = await importUsers([{ email: 'a@softwareone.com', password: 'Temporal1', permissions: ['not-a-permission'] }]);

    expect(result.rejected).toEqual([{ row: 0, reason: 'VALIDATION_ERROR' }]);
    expect(User.create).not.toHaveBeenCalled();
  });

  test('rejects a duplicate within the batch with EMAIL_ALREADY_EXISTS', async () => {
    const result = await importUsers([
      { email: 'A@SoftwareOne.com', password: 'Temporal1' },
      { email: 'a@softwareone.com', password: 'Temporal2' }
    ]);

    expect(result.created).toBe(1);
    expect(result.rejected).toEqual([{ row: 1, reason: 'EMAIL_ALREADY_EXISTS' }]);
    expect(User.create).toHaveBeenCalledTimes(1);
  });

  test('rejects a row already present in the DB with EMAIL_ALREADY_EXISTS', async () => {
    User.find.mockResolvedValue([{ email: 'Existing@softwareone.com' }]);
    const result = await importUsers([{ email: 'existing@softwareone.com', password: 'Temporal1' }]);

    expect(result).toEqual({ created: 0, rejected: [{ row: 0, reason: 'EMAIL_ALREADY_EXISTS' }] });
    expect(User.create).not.toHaveBeenCalled();
  });

  test('rejects a row whose domain is not allowed with EMAIL_DOMAIN_NOT_ALLOWED', async () => {
    isEmailAllowed.mockReturnValue(false);
    const result = await importUsers([buildRows()]);

    expect(result).toEqual({ created: 0, rejected: [{ row: 0, reason: 'EMAIL_DOMAIN_NOT_ALLOWED' }] });
    expect(User.create).not.toHaveBeenCalled();
    expect(hashPassword).not.toHaveBeenCalled();
  });

  test('rejects a row that violates the password policy with VALIDATION_ERROR', async () => {
    validatePasswordPolicy.mockImplementationOnce(() => {
      throw new PasswordPolicyError('La contraseña debe incluir un número', ['number']);
    });
    const result = await importUsers([buildRows()]);

    expect(result).toEqual({ created: 0, rejected: [{ row: 0, reason: 'VALIDATION_ERROR' }] });
    expect(hashPassword).not.toHaveBeenCalled();
    expect(User.create).not.toHaveBeenCalled();
  });

  test('maps a create race 11000 to a rejected row EMAIL_ALREADY_EXISTS', async () => {
    User.create.mockRejectedValue(Object.assign(new Error('duplicate'), { code: 11000 }));
    const result = await importUsers([buildRows()]);

    expect(result.created).toBe(0);
    expect(result.rejected).toEqual([{ row: 0, reason: 'EMAIL_ALREADY_EXISTS' }]);
  });

  test('logs and swallows a user_created event failure so the batch keeps going', async () => {
    createEvent.mockRejectedValueOnce(new Error('event store down'));

    const result = await importUsers([buildRows()]);

    expect(result).toEqual({ created: 1, rejected: [] });
    expect(logger.error).toHaveBeenCalledWith('🔴 Error creating user_created event', { error: 'event store down' });
  });

  test('processes a mixed batch independently and returns the summary in input order', async () => {
    isEmailAllowed.mockImplementation((email) => email.endsWith('@softwareone.com'));
    validatePasswordPolicy.mockImplementation((password) => {
      if (typeof password !== 'string' || password.length < 8) {
        throw new PasswordPolicyError('La contraseña debe tener al menos 8 caracteres', ['length']);
      }
    });
    User.find.mockResolvedValue([{ email: 'b@softwareone.com' }]);

    const rows = [
      { email: 'a@softwareone.com', password: 'Temporal1', permissions: ['project:read'] },
      { email: 'A@SoftwareOne.com', password: 'Temporal2' },
      { email: 'b@softwareone.com', password: 'Temporal2' },
      { email: 'c@private.com', password: 'Temporal2' },
      { email: 'd@softwareone.com', password: 'short' },
      { email: 'e@softwareone.com' },
      { email: 'F@softwareone.com', password: 'Temporal3' }
    ];

    const result = await importUsers(rows);

    expect(result.created).toBe(2);
    expect(result.rejected).toEqual([
      { row: 1, reason: 'EMAIL_ALREADY_EXISTS' },
      { row: 2, reason: 'EMAIL_ALREADY_EXISTS' },
      { row: 3, reason: 'EMAIL_DOMAIN_NOT_ALLOWED' },
      { row: 4, reason: 'VALIDATION_ERROR' },
      { row: 5, reason: 'VALIDATION_ERROR' }
    ]);
    const createdEmails = User.create.mock.calls.map((call) => call[0].email);
    expect(createdEmails).toEqual(['a@softwareone.com', 'f@softwareone.com']);
  });

  test('rethrows unexpected errors from find and create', async () => {
    const findError = new Error('db down');
    User.find.mockRejectedValueOnce(findError);
    await expect(importUsers([buildRows()])).rejects.toThrow('db down');

    User.find.mockResolvedValueOnce([]);
    const createError = new Error('boom');
    User.create.mockRejectedValueOnce(createError);
    await expect(importUsers([buildRows()])).rejects.toThrow('boom');
  });

  test('rethrows a non-policy error thrown by the password policy check', async () => {
    const policyError = new Error('policy service broken');
    validatePasswordPolicy.mockImplementationOnce(() => {
      throw policyError;
    });

    await expect(importUsers([buildRows()])).rejects.toThrow('policy service broken');
    expect(User.create).not.toHaveBeenCalled();
  });
});