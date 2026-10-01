jest.mock('../../src/models/User', () => require('../mocks/mongooseModel')());
jest.mock('../../src/services/passwordService', () => {
  const actual = jest.requireActual('../../src/services/passwordService');
  return {
    hashPassword: jest.fn(),
    validatePasswordPolicy: jest.fn(),
    generateProvisionalPassword: jest.fn(),
    PasswordPolicyError: actual.PasswordPolicyError
  };
});
jest.mock('../../src/services/domainService', () => ({
  isEmailAllowed: jest.fn()
}));
jest.mock('../../src/services/eventSourcingService', () => ({
  createEvent: jest.fn()
}));

const User = require('../../src/models/User');
const { hashPassword, validatePasswordPolicy, generateProvisionalPassword, PasswordPolicyError } = require('../../src/services/passwordService');
const { isEmailAllowed } = require('../../src/services/domainService');
const { createEvent } = require('../../src/services/eventSourcingService');
const { createUser, listUsers, updateUserStatus, updateUserProfile, resetPassword, importUsers } = require('../../src/controllers/userController');
const { ALL_PERMISSIONS } = require('../../src/models/permissions');

const VALID_ID = '507f1f77bcf86cd799439011';

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

function mockReq(body = {}, params = {}) {
  return { body, params };
}

function makeUser(overrides = {}) {
  const data = {
    _id: VALID_ID,
    email: 'user@softwareone.com',
    passwordHash: '$2b$10$hash',
    active: true,
    mustChangePassword: true,
    permissions: [],
    provider: 'local',
    externalId: null,
    ...overrides
  };
  const user = {
    ...data,
    save: jest.fn(),
    toJSON() {
      const { passwordHash, save, toJSON, ...rest } = this;
      return rest;
    }
  };
  user.save.mockResolvedValue(user);
  return user;
}

beforeEach(() => {
  jest.clearAllMocks();
  User.create = jest.fn();
  isEmailAllowed.mockReturnValue(true);
  hashPassword.mockResolvedValue('$2b$10$new-hash');
  validatePasswordPolicy.mockImplementation(() => {});
  generateProvisionalPassword.mockReturnValue('T68b4kPq9mVJlu');
  createEvent.mockResolvedValue({});
});

describe('createUser', () => {
  test('returns 400 VALIDATION_ERROR for an invalid body without writing', async () => {
    const res = mockRes();
    const next = jest.fn();

    await createUser(mockReq({ email: 'not-an-email' }), res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: { code: 'VALIDATION_ERROR', message: expect.any(String) }
    }));
    expect(User.create).not.toHaveBeenCalled();
    expect(hashPassword).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects permissions outside the catalog with 400', async () => {
    const res = mockRes();

    await createUser(mockReq({
      email: 'user@softwareone.com',
      password: 'Temporal1',
      permissions: ['not-a-permission']
    }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: { code: 'VALIDATION_ERROR', message: expect.any(String) }
    }));
    expect(User.create).not.toHaveBeenCalled();
  });

  test('returns 400 EMAIL_DOMAIN_NOT_ALLOWED when the domain is not allowed', async () => {
    isEmailAllowed.mockReturnValue(false);
    const res = mockRes();

    await createUser(mockReq({
      email: 'user@other.com',
      password: 'Temporal1'
    }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'EMAIL_DOMAIN_NOT_ALLOWED', message: 'El dominio del correo no está permitido' }
    });
    expect(hashPassword).not.toHaveBeenCalled();
    expect(User.create).not.toHaveBeenCalled();
  });

  test('returns 400 VALIDATION_ERROR when the password violates policy', async () => {
    validatePasswordPolicy.mockImplementationOnce(() => {
      throw new PasswordPolicyError('La contraseña debe incluir un número', ['number']);
    });
    const res = mockRes();

    await createUser(mockReq({
      email: 'user@softwareone.com',
      password: 'short'
    }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'La contraseña debe incluir un número' }
    });
    expect(hashPassword).not.toHaveBeenCalled();
    expect(User.create).not.toHaveBeenCalled();
  });

  test('creates a valid user with server-controlled flags and a hashed password', async () => {
    const created = makeUser({ email: 'user@softwareone.com', permissions: ['project:read'] });
    User.create.mockResolvedValue(created);
    const res = mockRes();

    await createUser(mockReq({
      email: 'user@softwareone.com',
      password: 'Temporal1',
      permissions: ['project:read']
    }), res, jest.fn());

    expect(isEmailAllowed).toHaveBeenCalledWith('user@softwareone.com');
    expect(hashPassword).toHaveBeenCalledWith('Temporal1');
    expect(User.create).toHaveBeenCalledWith(expect.objectContaining({
      email: 'user@softwareone.com',
      passwordHash: '$2b$10$new-hash',
      permissions: ['project:read'],
      active: true,
      mustChangePassword: true
    }));
    expect(res.status).toHaveBeenCalledWith(201);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data.user.mustChangePassword).toBe(true);
    expect(body.data.user.active).toBe(true);
    expect(body.data.user.passwordHash).toBeUndefined();
    expect(createEvent).toHaveBeenCalledWith('user_created', { userId: created._id, email: 'user@softwareone.com' }, {});
  });

  test('maps a duplicate key race error to 409 EMAIL_ALREADY_EXISTS', async () => {
    User.create.mockRejectedValue(Object.assign(new Error('duplicate'), { code: 11000 }));
    const res = mockRes();
    const next = jest.fn();

    await createUser(mockReq({
      email: 'user@softwareone.com',
      password: 'Temporal1'
    }), res, next);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'EMAIL_ALREADY_EXISTS', message: 'El email ya está registrado' }
    });
    expect(next).not.toHaveBeenCalled();
  });

  test('delegates unexpected errors to next', async () => {
    const error = new Error('boom');
    User.create.mockRejectedValue(error);
    const res = mockRes();
    const next = jest.fn();

    await createUser(mockReq({
      email: 'user@softwareone.com',
      password: 'Temporal1'
    }), res, next);

    expect(next).toHaveBeenCalledWith(error);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('rethrows a non-policy password validation error to next', async () => {
    const error = new Error('boom');
    validatePasswordPolicy.mockImplementationOnce(() => {
      throw error;
    });
    const res = mockRes();
    const next = jest.fn();

    await createUser(mockReq({
      email: 'user@softwareone.com',
      password: 'Temporal1'
    }), res, next);

    expect(next).toHaveBeenCalledWith(error);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('persists the three optional profile fields when provided', async () => {
    const created = makeUser({ firstName: 'Ana', lastName: 'Ruiz', jobTitle: 'Software Architect' });
    User.create.mockResolvedValue(created);
    const res = mockRes();

    await createUser(mockReq({
      email: 'user@softwareone.com',
      password: 'Temporal1',
      firstName: 'Ana',
      lastName: 'Ruiz',
      jobTitle: 'Software Architect'
    }), res, jest.fn());

    expect(User.create).toHaveBeenCalledWith(expect.objectContaining({
      firstName: 'Ana',
      lastName: 'Ruiz',
      jobTitle: 'Software Architect'
    }));
    expect(res.status).toHaveBeenCalledWith(201);
  });

  test('creates a user without profile fields', async () => {
    const created = makeUser();
    User.create.mockResolvedValue(created);
    const res = mockRes();

    await createUser(mockReq({ email: 'user@softwareone.com', password: 'Temporal1' }), res, jest.fn());

    expect(User.create).toHaveBeenCalledWith(expect.objectContaining({
      firstName: null,
      lastName: null,
      jobTitle: null
    }));
    expect(res.status).toHaveBeenCalledWith(201);
  });

  test('stores a blank profile value as null', async () => {
    const created = makeUser({ firstName: null });
    User.create.mockResolvedValue(created);

    await createUser(mockReq({
      email: 'user@softwareone.com',
      password: 'Temporal1',
      firstName: '   ',
      jobTitle: ''
    }), mockRes(), jest.fn());

    expect(User.create).toHaveBeenCalledWith(expect.objectContaining({
      firstName: null,
      jobTitle: null
    }));
  });

  test('rejects a profile field above its limit with 400', async () => {
    const res = mockRes();

    await createUser(mockReq({
      email: 'user@softwareone.com',
      password: 'Temporal1',
      jobTitle: 'x'.repeat(121)
    }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: { code: 'VALIDATION_ERROR', message: expect.any(String) }
    }));
    expect(User.create).not.toHaveBeenCalled();
  });

  test('rejects an unknown field such as fullName with 400', async () => {
    const res = mockRes();

    await createUser(mockReq({
      email: 'user@softwareone.com',
      password: 'Temporal1',
      fullName: 'Ana Ruiz'
    }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(User.create).not.toHaveBeenCalled();
  });
});

describe('listUsers', () => {
  test('returns users sorted by email without passwordHash', async () => {
    const first = makeUser({ _id: '507f1f77bcf86cd799439011', email: 'a@softwareone.com' });
    const second = makeUser({ _id: '507f1f77bcf86cd799439012', email: 'b@softwareone.com' });
    const sort = jest.fn().mockResolvedValue([first, second]);
    User.find.mockReturnValue({ sort });
    const res = mockRes();

    await listUsers({}, res, jest.fn());

    expect(User.find).toHaveBeenCalledTimes(1);
    expect(sort).toHaveBeenCalledWith({ email: 1 });
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: [
        expect.objectContaining({ email: 'a@softwareone.com' }),
        expect.objectContaining({ email: 'b@softwareone.com' })
      ]
    });
    const data = res.json.mock.calls[0][0].data;
    expect(data[0].passwordHash).toBeUndefined();
    expect(data[1].passwordHash).toBeUndefined();
  });

  test('delegates unexpected errors to next', async () => {
    const error = new Error('db down');
    User.find.mockReturnValue({ sort: jest.fn().mockRejectedValue(error) });
    const next = jest.fn();

    await listUsers({}, mockRes(), next);

    expect(next).toHaveBeenCalledWith(error);
  });
});

describe('updateUserStatus', () => {
  test('returns 400 VALIDATION_ERROR for an invalid body', async () => {
    const res = mockRes();

    await updateUserStatus(mockReq({ active: 'yes' }, { id: VALID_ID }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: { code: 'VALIDATION_ERROR', message: expect.any(String) }
    }));
    expect(User.findById).not.toHaveBeenCalled();
  });

  test('returns 400 for a malformed ObjectId', async () => {
    const res = mockRes();

    await updateUserStatus(mockReq({ active: false }, { id: 'not-an-object-id' }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: { code: 'VALIDATION_ERROR', message: 'Identificador de usuario inválido' }
    }));
    expect(User.findById).not.toHaveBeenCalled();
  });

  test('returns 404 when the user does not exist', async () => {
    User.findById.mockResolvedValue(null);
    const res = mockRes();

    await updateUserStatus(mockReq({ active: false }, { id: VALID_ID }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Usuario no encontrado' }
    });
  });

  test('updates active, saves and responds 200 without passwordHash', async () => {
    const user = makeUser({ active: true });
    User.findById.mockResolvedValue(user);
    const res = mockRes();

    await updateUserStatus(mockReq({ active: false }, { id: VALID_ID }), res, jest.fn());

    expect(User.findById).toHaveBeenCalledWith(VALID_ID);
    expect(user.active).toBe(false);
    expect(user.save).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { user: expect.objectContaining({ active: false }) } });
    const body = res.json.mock.calls[0][0];
    expect(body.data.user.passwordHash).toBeUndefined();
    expect(createEvent).toHaveBeenCalledWith('user_status_changed', { userId: user._id, email: user.email, active: false }, {});
  });

  test('delegates unexpected errors to next', async () => {
    const error = new Error('boom');
    User.findById.mockRejectedValue(error);
    const next = jest.fn();

    await updateUserStatus(mockReq({ active: false }, { id: VALID_ID }), mockRes(), next);

    expect(next).toHaveBeenCalledWith(error);
  });

  test('maps a CastError from findById to 400 VALIDATION_ERROR', async () => {
    const castError = Object.assign(new Error('cast'), { name: 'CastError' });
    User.findById.mockRejectedValue(castError);
    const res = mockRes();
    const next = jest.fn();

    await updateUserStatus(mockReq({ active: false }, { id: VALID_ID }), res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Identificador de usuario inválido' }
    });
    expect(next).not.toHaveBeenCalled();
  });
});

describe('updateUserProfile', () => {
  const profileUser = () => makeUser({
    firstName: 'Ana',
    lastName: 'Ruiz',
    jobTitle: 'Software Architect',
    permissions: ['users:write']
  });

  test('returns 400 for a malformed ObjectId', async () => {
    const res = mockRes();
    const next = jest.fn();

    await updateUserProfile(mockReq({ firstName: 'Ana' }, { id: 'not-an-object-id' }), res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Identificador de usuario inválido' }
    });
    expect(User.findById).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  test('returns 400 when the body carries no profile field', async () => {
    const res = mockRes();

    await updateUserProfile(mockReq({}, { id: VALID_ID }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: { code: 'VALIDATION_ERROR', message: expect.any(String) }
    }));
    expect(User.findById).not.toHaveBeenCalled();
  });

  test('rejects a field outside the whitelist with 400', async () => {
    const res = mockRes();

    await updateUserProfile(mockReq({ email: 'hijack@softwareone.com' }, { id: VALID_ID }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(User.findById).not.toHaveBeenCalled();
  });

  test('rejects a derived field with 400 so fullName cannot be written', async () => {
    const res = mockRes();

    await updateUserProfile(mockReq({ fullName: 'Ana Ruiz' }, { id: VALID_ID }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(User.findById).not.toHaveBeenCalled();
  });

  test('returns 404 when the user does not exist', async () => {
    User.findById.mockResolvedValue(null);
    const res = mockRes();

    await updateUserProfile(mockReq({ jobTitle: 'Architect' }, { id: VALID_ID }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Usuario no encontrado' }
    });
    expect(createEvent).not.toHaveBeenCalled();
  });

  test('updates the three fields, saves once and responds 200', async () => {
    const user = profileUser();
    User.findById.mockResolvedValue(user);
    const res = mockRes();

    await updateUserProfile(mockReq({
      firstName: '  Ana María ',
      lastName: 'Ruiz Soto',
      jobTitle: 'Principal Architect'
    }, { id: VALID_ID }), res, jest.fn());

    expect(User.findById).toHaveBeenCalledWith(VALID_ID);
    expect(user.firstName).toBe('Ana María');
    expect(user.lastName).toBe('Ruiz Soto');
    expect(user.jobTitle).toBe('Principal Architect');
    expect(user.save).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { user: expect.objectContaining({ jobTitle: 'Principal Architect' }) }
    });
    const body = res.json.mock.calls[0][0];
    expect(body.data.user.passwordHash).toBeUndefined();
  });

  test('leaves the credential, role and status fields untouched', async () => {
    const user = profileUser();
    User.findById.mockResolvedValue(user);

    await updateUserProfile(mockReq({ jobTitle: 'Principal Architect' }, { id: VALID_ID }), mockRes(), jest.fn());

    expect(user.email).toBe('user@softwareone.com');
    expect(user.permissions).toEqual(['users:write']);
    expect(user.active).toBe(true);
    expect(user.mustChangePassword).toBe(true);
    expect(user.mustChangePassword).toBe(true);
    expect(user.passwordHash).toBe('$2b$10$hash');
  });

  test.each([
    ['null', null],
    ['an empty string', ''],
    ['a blank string', '   ']
  ])('clears a field sent as %s', async (_label, input) => {
    const user = profileUser();
    User.findById.mockResolvedValue(user);

    await updateUserProfile(mockReq({ jobTitle: input }, { id: VALID_ID }), mockRes(), jest.fn());

    expect(user.jobTitle).toBeNull();
    expect(user.save).toHaveBeenCalledTimes(1);
  });

  test('emits user_profile_updated carrying only the fields that changed', async () => {
    const user = profileUser();
    User.findById.mockResolvedValue(user);

    await updateUserProfile(mockReq({
      jobTitle: 'Principal Architect'
    }, { id: VALID_ID }), mockRes(), jest.fn());

    expect(createEvent).toHaveBeenCalledWith(
      'user_profile_updated',
      { userId: VALID_ID, changed: { jobTitle: 'Principal Architect' } },
      {}
    );
  });

  test('reports the normalized value when a field is cleared', async () => {
    const user = profileUser();
    User.findById.mockResolvedValue(user);

    await updateUserProfile(mockReq({ firstName: '' }, { id: VALID_ID }), mockRes(), jest.fn());

    expect(createEvent).toHaveBeenCalledWith(
      'user_profile_updated',
      { userId: VALID_ID, changed: { firstName: null } },
      {}
    );
  });

  test('emits an empty changed object when the values are resubmitted unchanged', async () => {
    const user = profileUser();
    User.findById.mockResolvedValue(user);

    await updateUserProfile(mockReq({ jobTitle: 'Software Architect' }, { id: VALID_ID }), mockRes(), jest.fn());

    expect(createEvent).toHaveBeenCalledWith(
      'user_profile_updated',
      { userId: VALID_ID, changed: {} },
      {}
    );
  });

  test('delegates unexpected errors to next', async () => {
    const error = new Error('boom');
    User.findById.mockRejectedValue(error);
    const res = mockRes();
    const next = jest.fn();

    await updateUserProfile(mockReq({ jobTitle: 'Architect' }, { id: VALID_ID }), res, next);

    expect(next).toHaveBeenCalledWith(error);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('maps a CastError from findById to 400 VALIDATION_ERROR', async () => {
    const castError = Object.assign(new Error('cast'), { name: 'CastError' });
    User.findById.mockRejectedValue(castError);
    const res = mockRes();
    const next = jest.fn();

    await updateUserProfile(mockReq({ jobTitle: 'Architect' }, { id: VALID_ID }), res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Identificador de usuario inválido' }
    });
    expect(next).not.toHaveBeenCalled();
  });
});

describe('resetPassword', () => {
  test('returns 400 for a malformed ObjectId', async () => {
    const res = mockRes();
    const next = jest.fn();

    await resetPassword(mockReq(undefined, { id: 'not-an-object-id' }), res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: { code: 'VALIDATION_ERROR', message: 'Identificador de usuario inválido' }
    }));
    expect(User.findById).not.toHaveBeenCalled();
    expect(generateProvisionalPassword).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  test('returns 404 when the user does not exist', async () => {
    User.findById.mockResolvedValue(null);
    const res = mockRes();
    const next = jest.fn();

    await resetPassword(mockReq(undefined, { id: VALID_ID }), res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Usuario no encontrado' }
    });
    expect(generateProvisionalPassword).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  test('hashes the provisional, forces mustChangePassword and responds 200 with the provisional once', async () => {
    const user = makeUser({ mustChangePassword: false });
    User.findById.mockResolvedValue(user);
    const res = mockRes();
    const next = jest.fn();

    await resetPassword(mockReq(undefined, { id: VALID_ID }), res, next);

    expect(User.findById).toHaveBeenCalledWith(VALID_ID);
    expect(generateProvisionalPassword).toHaveBeenCalledTimes(1);
    expect(hashPassword).toHaveBeenCalledWith('T68b4kPq9mVJlu');
    expect(user.passwordHash).toBe('$2b$10$new-hash');
    expect(user.mustChangePassword).toBe(true);
    expect(user.save).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: {
        user: expect.objectContaining({ mustChangePassword: true }),
        provisionalPassword: 'T68b4kPq9mVJlu'
      }
    });
    const body = res.json.mock.calls[0][0];
    expect(body.data.user.passwordHash).toBeUndefined();
    expect(body.data.user.provisionalPassword).toBeUndefined();
    expect(createEvent).toHaveBeenCalledWith('user_password_reset', { userId: user._id, email: user.email }, {});
    expect(next).not.toHaveBeenCalled();
  });

  test('delegates unexpected errors to next', async () => {
    const error = new Error('boom');
    User.findById.mockRejectedValue(error);
    const next = jest.fn();

    await resetPassword(mockReq(undefined, { id: VALID_ID }), mockRes(), next);

    expect(next).toHaveBeenCalledWith(error);
  });

  test('maps a CastError from findById to 400 VALIDATION_ERROR', async () => {
    const castError = Object.assign(new Error('cast'), { name: 'CastError' });
    User.findById.mockRejectedValue(castError);
    const res = mockRes();
    const next = jest.fn();

    await resetPassword(mockReq(undefined, { id: VALID_ID }), res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Identificador de usuario inválido' }
    });
    expect(next).not.toHaveBeenCalled();
  });
});

describe('importUsers', () => {
  test('returns 400 VALIDATION_ERROR when users is missing, not an array or has non-object rows', async () => {
    const missing = mockRes();
    const notArray = mockRes();
    const nonObjectRow = mockRes();

    await importUsers(mockReq({}), missing, jest.fn());
    await importUsers(mockReq({ users: 'not-an-array' }), notArray, jest.fn());
    await importUsers(mockReq({ users: ['not-an-object'] }), nonObjectRow, jest.fn());

    expect(missing.status).toHaveBeenCalledWith(400);
    expect(notArray.status).toHaveBeenCalledWith(400);
    expect(nonObjectRow.status).toHaveBeenCalledWith(400);
    expect(missing.json).toHaveBeenCalledWith(expect.objectContaining({
      error: { code: 'VALIDATION_ERROR', message: expect.any(String) }
    }));
    expect(notArray.json).toHaveBeenCalledWith(expect.objectContaining({
      error: { code: 'VALIDATION_ERROR', message: expect.any(String) }
    }));
    expect(nonObjectRow.json).toHaveBeenCalledWith(expect.objectContaining({
      error: { code: 'VALIDATION_ERROR', message: expect.any(String) }
    }));
    expect(User.find).not.toHaveBeenCalled();
    expect(User.create).not.toHaveBeenCalled();
  });

  test('returns 200 with the import summary delegating to the bulk service', async () => {
    User.find.mockResolvedValue([]);
    User.create.mockResolvedValue(makeUser({ email: 'a@softwareone.com' }));
    const res = mockRes();
    const next = jest.fn();

    await importUsers(mockReq({ users: [{ email: 'a@softwareone.com', password: 'Temporal1' }] }), res, next);

    expect(User.find).toHaveBeenCalledWith(expect.objectContaining({
      email: expect.objectContaining({ $in: ['a@softwareone.com'] })
    }));
    expect(User.create).toHaveBeenCalledWith(expect.objectContaining({
      email: 'a@softwareone.com',
      mustChangePassword: true,
      active: true
    }));
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { created: 1, rejected: [] }
    });
    expect(createEvent).toHaveBeenCalledWith('user_created', { userId: expect.any(String), email: 'a@softwareone.com' }, {});
    expect(next).not.toHaveBeenCalled();
  });

  test('delegates unexpected errors to next', async () => {
    const error = new Error('db down');
    User.find.mockRejectedValue(error);
    const res = mockRes();
    const next = jest.fn();

    await importUsers(mockReq({ users: [{ email: 'a@softwareone.com', password: 'Temporal1' }] }), res, next);

    expect(next).toHaveBeenCalledWith(error);
    expect(res.status).not.toHaveBeenCalled();
  });
});

// D-007: el schema Joi hace spread del catalogo, asi que ampliarlo no exige editar
// userController.js. Estos tests fijan esa propagacion como invariante.
describe('el catalogo de 13 llega a la validacion Joi sin editar el controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    isEmailAllowed.mockReturnValue(true);
    hashPassword.mockResolvedValue('$2b$10$new-hash');
  });

  test('createUser acepta un usuario con los 13 permisos', async () => {
    User.create.mockResolvedValue(makeUser({ permissions: [...ALL_PERMISSIONS] }));
    const res = mockRes();

    await createUser(mockReq({
      email: 'user@softwareone.com',
      password: 'Temporal1',
      permissions: [...ALL_PERMISSIONS]
    }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(201);
    expect(User.create).toHaveBeenCalledWith(expect.objectContaining({
      permissions: expect.arrayContaining([...ALL_PERMISSIONS])
    }));
  });

  test.each(['project:members', 'document:responsible', 'evidence:read', 'evidence:write'])(
    'createUser acepta el permiso nuevo %s aislado',
    async (permission) => {
      User.create.mockResolvedValue(makeUser({ permissions: [permission] }));
      const res = mockRes();

      await createUser(mockReq({
        email: 'user@softwareone.com',
        password: 'Temporal1',
        permissions: [permission]
      }), res, jest.fn());

      expect(res.status).toHaveBeenCalledWith(201);
    }
  );

  test('createUser sigue rechazando un permiso fuera del catalogo', async () => {
    const res = mockRes();

    await createUser(mockReq({
      email: 'user@softwareone.com',
      password: 'Temporal1',
      permissions: ['admin:*']
    }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(User.create).not.toHaveBeenCalled();
  });
});
