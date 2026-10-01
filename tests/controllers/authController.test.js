jest.mock('../../src/models/User', () => require('../mocks/mongooseModel')());
jest.mock('../../src/services/passwordService', () => {
  const actual = jest.requireActual('../../src/services/passwordService');
  return {
    ...actual,
    verifyPassword: jest.fn(),
    validatePasswordPolicy: jest.fn(),
    hashPassword: jest.fn()
  };
});
jest.mock('../../src/services/tokenService', () => ({
  COOKIE_NAME: 'dm_token',
  signToken: jest.fn(),
  buildCookieOptions: jest.fn(() => ({ httpOnly: true, path: '/' }))
}));
jest.mock('../../src/services/eventSourcingService', () => ({
  createEvent: jest.fn()
}));

const User = require('../../src/models/User');
const {
  verifyPassword,
  validatePasswordPolicy,
  hashPassword,
  PasswordPolicyError
} = require('../../src/services/passwordService');
const { COOKIE_NAME, signToken } = require('../../src/services/tokenService');
const { createEvent } = require('../../src/services/eventSourcingService');
const { login, changePassword, getMe, logout } = require('../../src/controllers/authController');

function mockRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
    cookie: jest.fn(),
    clearCookie: jest.fn()
  };
}

function mockReq(body, extra = {}) {
  return { body, ...extra };
}

function mockUser(overrides = {}) {
  const data = {
    _id: 'u1',
    email: 'admin@softwareone.com',
    passwordHash: '$2b$10$hash',
    active: true,
    mustChangePassword: true,
    permissions: ['project:read'],
    ...overrides
  };
  const user = {
    ...data,
    save: jest.fn(),
    toJSON() {
      const { passwordHash, ...rest } = this;
      delete rest.save;
      delete rest.toJSON;
      return rest;
    }
  };
  user.save.mockResolvedValue(user);
  return user;
}

beforeEach(() => {
  jest.clearAllMocks();
  validatePasswordPolicy.mockImplementation(() => {});
  hashPassword.mockResolvedValue('$2b$10$new-hash');
  createEvent.mockResolvedValue({});
});

describe('login', () => {
  test('signs a JWT, sets an httpOnly cookie and returns the user on success', async () => {
    verifyPassword.mockResolvedValue(true);
    signToken.mockResolvedValue('jwt-token');
    User.findOne.mockResolvedValue(mockUser());
    const resetLoginAttempts = jest.fn();
    const req = mockReq({ email: 'admin@softwareone.com', password: 'RealPass1' });
    const res = mockRes();
    const next = jest.fn();

    await login(req, res, next, { resetLoginAttempts });

    expect(User.findOne).toHaveBeenCalledWith({ email: 'admin@softwareone.com' });
    expect(verifyPassword).toHaveBeenCalledWith('RealPass1', '$2b$10$hash');
    expect(signToken).toHaveBeenCalledWith('u1');
    expect(res.cookie).toHaveBeenCalledWith(COOKIE_NAME, 'jwt-token', expect.objectContaining({ httpOnly: true }));
    expect(resetLoginAttempts).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalledWith(401);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data.user).toEqual(expect.not.objectContaining({ passwordHash: expect.anything() }));
    expect(body.data.mustChangePassword).toBe(true);
    expect(createEvent).toHaveBeenCalledWith('user_login_succeeded', { userId: 'u1', email: 'admin@softwareone.com' }, {});
    expect(next).not.toHaveBeenCalled();
  });

  test('succeeds even without a reset callback', async () => {
    verifyPassword.mockResolvedValue(true);
    signToken.mockResolvedValue('jwt-token');
    User.findOne.mockResolvedValue(mockUser());
    const res = mockRes();
    await login(mockReq({ email: 'admin@softwareone.com', password: 'RealPass1' }), res, jest.fn());
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true })
    );
  });

  test('does not fail login when the audit event cannot be persisted', async () => {
    verifyPassword.mockResolvedValue(true);
    signToken.mockResolvedValue('jwt-token');
    User.findOne.mockResolvedValue(mockUser());
    createEvent.mockRejectedValue(new Error('event db down'));
    const res = mockRes();
    const next = jest.fn();

    await login(mockReq({ email: 'admin@softwareone.com', password: 'RealPass1' }), res, next);

    expect(createEvent).toHaveBeenCalledWith('user_login_succeeded', expect.anything(), {});
    expect(res.cookie).toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].success).toBe(true);
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects 403 ACCOUNT_DISABLED without a cookie when user is inactive', async () => {
    User.findOne.mockResolvedValue(mockUser({ active: false }));
    const res = mockRes();
    await login(mockReq({ email: 'admin@softwareone.com', password: 'RealPass1' }), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'ACCOUNT_DISABLED', message: 'Cuenta deshabilitada' }
    });
    expect(createEvent).toHaveBeenCalledWith('user_login_failed', { email: 'admin@softwareone.com', userId: 'u1' }, {});
    expect(res.cookie).not.toHaveBeenCalled();
  });

  test('rejects 401 without leaking whether the email exists (unknown email vs wrong password)', async () => {
    User.findOne.mockResolvedValueOnce(null);
    const resUnknown = mockRes();
    await login(mockReq({ email: 'ghost@nowhere.com', password: 'Whatever1' }), resUnknown, jest.fn());
    const unknownMessage = resUnknown.json.mock.calls[0][0].error.message;
    expect(resUnknown.status).toHaveBeenCalledWith(401);
    expect(createEvent).toHaveBeenCalledWith('user_login_failed', { email: 'ghost@nowhere.com' }, {});

    verifyPassword.mockResolvedValue(false);
    User.findOne.mockResolvedValueOnce(mockUser());
    const resWrong = mockRes();
    await login(mockReq({ email: 'admin@softwareone.com', password: 'WrongPass1' }), resWrong, jest.fn());
    expect(resWrong.status).toHaveBeenCalledWith(401);
    expect(createEvent).toHaveBeenCalledWith('user_login_failed', { email: 'admin@softwareone.com', userId: 'u1' }, {});
    expect(resWrong.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'INVALID_CREDENTIALS', message: unknownMessage }
    });
    expect(resWrong.cookie).not.toHaveBeenCalled();
  });

  test('rejects 400 VALIDATION_ERROR for an invalid body', async () => {
    const res = mockRes();
    await login(mockReq({ email: 'not-an-email' }), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].error.code).toBe('VALIDATION_ERROR');
    expect(res.cookie).not.toHaveBeenCalled();
  });

  test('rejects 400 VALIDATION_ERROR when the body is missing', async () => {
    const res = mockRes();
    await login(mockReq(), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].error.code).toBe('VALIDATION_ERROR');
    expect(User.findOne).not.toHaveBeenCalled();
  });

  test('forwards unexpected errors to next(err)', async () => {
    User.findOne.mockRejectedValue(new Error('db down'));
    const next = jest.fn();
    await login(mockReq({ email: 'admin@softwareone.com', password: 'RealPass1' }), mockRes(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

describe('changePassword', () => {
  const validBody = {
    currentPassword: 'CurrentPass1',
    newPassword: 'NewPassword1'
  };

  test('updates the authenticated user hash and clears mustChangePassword', async () => {
    const user = mockUser();
    User.findById.mockResolvedValue(user);
    verifyPassword.mockResolvedValue(true);
    hashPassword.mockResolvedValue('$2b$10$new-hash');
    const res = mockRes();
    const next = jest.fn();

    await changePassword(mockReq(validBody, { user: { _id: 'u1' } }), res, next);

    expect(User.findById).toHaveBeenCalledWith('u1');
    expect(verifyPassword).toHaveBeenCalledWith('CurrentPass1', '$2b$10$hash');
    expect(validatePasswordPolicy).toHaveBeenCalledWith('NewPassword1');
    expect(hashPassword).toHaveBeenCalledWith('NewPassword1');
    expect(user.passwordHash).toBe('$2b$10$new-hash');
    expect(user.mustChangePassword).toBe(false);
    expect(user.save).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data.user.passwordHash).toBeUndefined();
    expect(body.data.user.mustChangePassword).toBe(false);
    expect(body.data.mustChangePassword).toBe(false);
    expect(createEvent).toHaveBeenCalledWith('user_password_changed', { userId: 'u1' }, {});
    expect(next).not.toHaveBeenCalled();
  });

  test('does not fail changePassword when the audit event cannot be persisted', async () => {
    const user = mockUser();
    User.findById.mockResolvedValue(user);
    verifyPassword.mockResolvedValue(true);
    createEvent.mockRejectedValue(new Error('event db down'));
    const res = mockRes();

    await changePassword(mockReq(validBody, { user: { _id: 'u1' } }), res, jest.fn());

    expect(user.save).toHaveBeenCalledTimes(1);
    expect(res.json.mock.calls[0][0].success).toBe(true);
  });

  test('rejects an incorrect current password without hashing or saving', async () => {
    const user = mockUser();
    User.findById.mockResolvedValue(user);
    verifyPassword.mockResolvedValue(false);
    const res = mockRes();

    await changePassword(mockReq(validBody, { user: { _id: 'u1' } }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'INVALID_CURRENT_PASSWORD', message: 'La contraseña actual es incorrecta' }
    });
    expect(validatePasswordPolicy).not.toHaveBeenCalled();
    expect(hashPassword).not.toHaveBeenCalled();
    expect(user.save).not.toHaveBeenCalled();
  });

  test('maps a password policy error to 400 VALIDATION_ERROR', async () => {
    const user = mockUser();
    User.findById.mockResolvedValue(user);
    verifyPassword.mockResolvedValue(true);
    validatePasswordPolicy.mockImplementationOnce(() => {
      throw new PasswordPolicyError('La contraseña debe incluir un número', ['number']);
    });
    const res = mockRes();

    await changePassword(mockReq(validBody, { user: { _id: 'u1' } }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'La contraseña debe incluir un número' }
    });
    expect(hashPassword).not.toHaveBeenCalled();
    expect(user.save).not.toHaveBeenCalled();
  });

  test('returns 401 when called without an authenticated user', async () => {
    const res = mockRes();

    await changePassword(mockReq(validBody), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json.mock.calls[0][0].error.code).toBe('UNAUTHENTICATED');
    expect(User.findById).not.toHaveBeenCalled();
  });

  test('forwards unexpected policy errors to next(err)', async () => {
    const user = mockUser();
    User.findById.mockResolvedValue(user);
    verifyPassword.mockResolvedValue(true);
    validatePasswordPolicy.mockImplementationOnce(() => {
      throw new Error('policy service failed');
    });
    const next = jest.fn();

    await changePassword(mockReq(validBody, { user: { _id: 'u1' } }), mockRes(), next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(hashPassword).not.toHaveBeenCalled();
    expect(user.save).not.toHaveBeenCalled();
  });

  test('forwards hashing errors to next(err)', async () => {
    const user = mockUser();
    User.findById.mockResolvedValue(user);
    verifyPassword.mockResolvedValue(true);
    hashPassword.mockRejectedValue(new Error('hash failed'));
    const next = jest.fn();

    await changePassword(mockReq(validBody, { user: { _id: 'u1' } }), mockRes(), next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(user.save).not.toHaveBeenCalled();
  });

  test('rejects a missing body before accessing the user', async () => {
    const res = mockRes();

    await changePassword(mockReq(), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].error.code).toBe('VALIDATION_ERROR');
    expect(User.findById).not.toHaveBeenCalled();
  });

  test('rejects a userId field instead of selecting another user', async () => {
    const res = mockRes();

    await changePassword(
      mockReq({ currentPassword: 'CurrentPass1', newPassword: 'NewPassword1', userId: 'u2' }, { user: { _id: 'u1' } }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].error.code).toBe('VALIDATION_ERROR');
    expect(User.findById).not.toHaveBeenCalled();
  });

  test('returns 401 when the authenticated user is no longer available', async () => {
    User.findById.mockResolvedValue(null);
    const res = mockRes();

    await changePassword(mockReq(validBody, { user: { _id: 'u1' } }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'UNAUTHENTICATED', message: 'Sesión inválida o expirada' }
    });
    expect(verifyPassword).not.toHaveBeenCalled();
  });

  test('forwards persistence errors to next(err)', async () => {
    const user = mockUser();
    user.save.mockRejectedValue(new Error('save failed'));
    User.findById.mockResolvedValue(user);
    verifyPassword.mockResolvedValue(true);
    const next = jest.fn();

    await changePassword(mockReq(validBody, { user: { _id: 'u1' } }), mockRes(), next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(user.passwordHash).toBe('$2b$10$new-hash');
  });

  test('forwards unexpected lookup errors to next(err)', async () => {
    User.findById.mockRejectedValue(new Error('db down'));
    const next = jest.fn();

    await changePassword(mockReq(validBody, { user: { _id: 'u1' } }), mockRes(), next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

describe('getMe', () => {
  test('returns the authenticated user from req.user', () => {
    const res = mockRes();
    const req = { user: { email: 'admin@softwareone.com' } };
    getMe(req, res);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { user: { email: 'admin@softwareone.com' } }
    });
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe('logout', () => {
  test('clears the session cookie with the same path and returns success', () => {
    const res = mockRes();
    logout({}, res);
    expect(res.clearCookie).toHaveBeenCalledWith('dm_token', expect.objectContaining({ path: '/' }));
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });
});