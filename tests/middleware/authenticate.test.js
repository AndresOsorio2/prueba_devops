jest.mock('../../src/models/User', () => require('../mocks/mongooseModel')());
jest.mock('../../src/services/tokenService', () => ({
  COOKIE_NAME: 'dm_token',
  verifyToken: jest.fn()
}));

const User = require('../../src/models/User');
const { verifyToken } = require('../../src/services/tokenService');
const authenticate = require('../../src/middleware/authenticate');

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

function mockReq(overrides = {}) {
  return { cookies: {}, ...overrides };
}

function mockUser(overrides = {}) {
  const data = {
    _id: 'u1',
    email: 'admin@softwareone.com',
    passwordHash: 'secret-hash',
    active: true,
    permissions: ['project:read'],
    ...overrides
  };
  return {
    ...data,
    toJSON() {
      const { passwordHash, ...rest } = data;
      return rest;
    }
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('authenticate middleware', () => {
  test('rejects 401 UNAUTHENTICATED when cookie is missing', async () => {
    const res = mockRes();
    const next = jest.fn();
    await authenticate(mockReq(), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'UNAUTHENTICATED', message: expect.any(String) }
    });
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects 401 when the token is invalid', async () => {
    verifyToken.mockRejectedValue(new Error('jwt malformed'));
    const res = mockRes();
    const next = jest.fn();
    await authenticate(mockReq({ cookies: { dm_token: 'bad-token' } }), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json.mock.calls[0][0].error.code).toBe('UNAUTHENTICATED');
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects 401 when the token is expired', async () => {
    verifyToken.mockRejectedValue(new Error('jwt expired'));
    const res = mockRes();
    const next = jest.fn();
    await authenticate(mockReq({ cookies: { dm_token: 'expired-token' } }), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects 401 when the user no longer exists', async () => {
    verifyToken.mockResolvedValue({ sub: 'u1' });
    User.findById.mockResolvedValue(null);
    const res = mockRes();
    const next = jest.fn();
    await authenticate(mockReq({ cookies: { dm_token: 'valid' } }), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects 401 when the user is inactive (revocation)', async () => {
    verifyToken.mockResolvedValue({ sub: 'u1' });
    User.findById.mockResolvedValue(mockUser({ active: false }));
    const res = mockRes();
    const next = jest.fn();
    await authenticate(mockReq({ cookies: { dm_token: 'valid' } }), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(User.findById).toHaveBeenCalledWith('u1');
    expect(next).not.toHaveBeenCalled();
  });

  test('sets req.user without passwordHash and calls next on valid session', async () => {
    verifyToken.mockResolvedValue({ sub: 'u1' });
    User.findById.mockResolvedValue(mockUser());
    const req = mockReq({ cookies: { dm_token: 'valid' } });
    const res = mockRes();
    const next = jest.fn();
    await authenticate(req, res, next);
    expect(req.user).toEqual(expect.objectContaining({ email: 'admin@softwareone.com' }));
    expect(req.user.passwordHash).toBeUndefined();
    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  test('strips passwordHash even when the user lacks toJSON', async () => {
    verifyToken.mockResolvedValue({ sub: 'u1' });
    User.findById.mockResolvedValue({
      _id: 'u1',
      email: 'plain@user.com',
      passwordHash: 'secret-hash',
      active: true
    });
    const req = mockReq({ cookies: { dm_token: 'valid' } });
    const res = mockRes();
    const next = jest.fn();
    await authenticate(req, res, next);
    expect(req.user.passwordHash).toBeUndefined();
    expect(req.user.email).toBe('plain@user.com');
    expect(next).toHaveBeenCalled();
  });

  test('forwards unexpected DB errors to next(err)', async () => {
    verifyToken.mockResolvedValue({ sub: 'u1' });
    User.findById.mockRejectedValue(new Error('db down'));
    const res = mockRes();
    const next = jest.fn();
    await authenticate(mockReq({ cookies: { dm_token: 'valid' } }), res, next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(res.json).not.toHaveBeenCalled();
  });
});