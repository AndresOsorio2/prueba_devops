process.env.JWT_SECRET = 'integration-secret-rimac';
process.env.TOKEN_EXPIRES_IN = '1h';
process.env.CORS_ORIGIN = 'http://localhost:8083';
process.env.NODE_ENV = 'test';

jest.mock('../../src/models/User', () => require('../mocks/mongooseModel')());
jest.mock('../../src/models/Event', () => require('../mocks/mongooseModel')());
jest.mock('../../src/services/passwordService', () => {
  const actual = jest.requireActual('../../src/services/passwordService');
  return {
    ...actual,
    verifyPassword: jest.fn(),
    validatePasswordPolicy: jest.fn(),
    hashPassword: jest.fn()
  };
});
jest.mock('../../src/services/eventSourcingService', () => ({
  createEvent: jest.fn().mockResolvedValue({}),
  getProjectEvents: jest.fn(),
  getProjectTimeline: jest.fn()
}));

const request = require('supertest');
const { createApp } = require('../../src/app');
const User = require('../../src/models/User');
const {
  verifyPassword,
  validatePasswordPolicy,
  hashPassword,
  PasswordPolicyError
} = require('../../src/services/passwordService');

const app = createApp();

function makeUser(overrides = {}) {
  const data = {
    _id: 'u1',
    email: 'admin@softwareone.com',
    passwordHash: '$2b$10$hash',
    active: true,
    mustChangePassword: true,
    permissions: ['project:read', 'project:write'],
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
});

async function loginAndGetCookieForChange() {
  User.findOne.mockResolvedValue(makeUser());
  verifyPassword.mockResolvedValue(true);
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: 'admin@softwareone.com', password: 'RealPass1' })
    .expect(200);
  return res.headers['set-cookie'][0].split(';')[0];
}

describe('AC10 - public vs protected routes', () => {
  test('/health responds 200 without a session', async () => {
    const res = await request(app).get('/health').expect(200);
    expect(res.body.status).toBe('ok');
  });

  test('project routes respond 401 UNAUTHENTICATED without a session', async () => {
    const res = await request(app).get('/api/projects').expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  test('me/logout/change-password respond 401 without a session', async () => {
    await request(app).get('/api/auth/me').expect(401);
    await request(app).post('/api/auth/logout').expect(401);
    await request(app)
      .post('/api/auth/change-password')
      .send({ currentPassword: 'CurrentPass1', newPassword: 'NewPassword1' })
      .expect(401);
  });
});

describe('AC9 - strict CORS origin with credentials', () => {
  const preflight = () => request(app).options('/api/auth/login')
    .set('Origin', 'http://localhost:8083')
    .set('Access-Control-Request-Method', 'POST');

  test('allows the configured origin with credentials', async () => {
    const res = await request(app).get('/health').set('Origin', 'http://localhost:8083');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:8083');
  });

  test('does not emit CORS headers for a foreign origin', async () => {
    const res = await request(app).get('/health').set('Origin', 'http://evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  test('preflight for the configured origin returns allowed headers', async () => {
    await preflight().expect(204);
  });
});

describe('AC1/AC2/AC3 - login', () => {
  test('valid credentials set an httpOnly dm_token cookie', async () => {
    User.findOne.mockResolvedValue(makeUser());
    verifyPassword.mockResolvedValue(true);
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@softwareone.com', password: 'RealPass1' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.user.passwordHash).toBeUndefined();
    const cookie = res.headers['set-cookie'][0];
    expect(cookie).toContain('dm_token=');
    expect(cookie).toContain('HttpOnly');
  });

  test('inactive user returns 403 ACCOUNT_DISABLED without a cookie', async () => {
    User.findOne.mockResolvedValue(makeUser({ active: false }));
    verifyPassword.mockResolvedValue(true);
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@softwareone.com', password: 'RealPass1' })
      .expect(403);
    expect(res.body.error.code).toBe('ACCOUNT_DISABLED');
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  test('unknown email returns 401 INVALID_CREDENTIALS', async () => {
    User.findOne.mockResolvedValue(null);
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ghost@nowhere.com', password: 'Whatever1' })
      .expect(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(res.headers['set-cookie']).toBeUndefined();
  });
});

describe('AC5/AC6/AC7 - session and /me', () => {
  async function loginAndGetCookie() {
    User.findOne.mockResolvedValue(makeUser());
    verifyPassword.mockResolvedValue(true);
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@softwareone.com', password: 'RealPass1' })
      .expect(200);
    return res.headers['set-cookie'][0].split(';')[0];
  }

  test('me returns the user without passwordHash using the session cookie', async () => {
    const cookie = await loginAndGetCookie();
    User.findById.mockResolvedValue(makeUser());
    const res = await request(app).get('/api/auth/me').set('Cookie', cookie).expect(200);
    expect(res.body.data.user.email).toBe('admin@softwareone.com');
    expect(res.body.data.user.passwordHash).toBeUndefined();
  });

  test('invalid token is rejected with 401', async () => {
    await request(app).get('/api/auth/me').set('Cookie', 'dm_token=garbage').expect(401);
  });

  test('logout clears the session cookie', async () => {
    const cookie = await loginAndGetCookie();
    const res = await request(app).post('/api/auth/logout').set('Cookie', cookie).expect(200);
    expect(res.body.success).toBe(true);
    const cleared = res.headers['set-cookie'][0];
    expect(cleared).toContain('dm_token=');
    expect(cleared).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/);
  });
});

describe('AC1-AC5 - change password', () => {
  async function authenticatedUser() {
    const cookie = await loginAndGetCookieForChange();
    const user = makeUser();
    User.findById.mockResolvedValue(user);
    return { cookie, user };
  }

  test('changes the authenticated user password and clears the required-change flag', async () => {
    const { cookie, user } = await authenticatedUser();

    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Cookie', cookie)
      .send({ currentPassword: 'CurrentPass1', newPassword: 'NewPassword1' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.user.passwordHash).toBeUndefined();
    expect(res.body.data.user.mustChangePassword).toBe(false);
    expect(res.body.data.mustChangePassword).toBe(false);
    expect(user.passwordHash).toBe('$2b$10$new-hash');
    expect(user.mustChangePassword).toBe(false);
    expect(user.save).toHaveBeenCalledTimes(1);
  });

  test('returns 400 when the current password is incorrect', async () => {
    const { cookie, user } = await authenticatedUser();
    verifyPassword.mockResolvedValue(false);

    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Cookie', cookie)
      .send({ currentPassword: 'WrongPass1', newPassword: 'NewPassword1' })
      .expect(400);

    expect(res.body.error.code).toBe('INVALID_CURRENT_PASSWORD');
    expect(hashPassword).not.toHaveBeenCalled();
    expect(user.save).not.toHaveBeenCalled();
  });

  test('returns 400 VALIDATION_ERROR when the new password violates policy', async () => {
    const { cookie, user } = await authenticatedUser();
    validatePasswordPolicy.mockImplementationOnce(() => {
      throw new PasswordPolicyError('La contraseña debe incluir un número', ['number']);
    });

    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Cookie', cookie)
      .send({ currentPassword: 'CurrentPass1', newPassword: 'newpassword' })
      .expect(400);

    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(hashPassword).not.toHaveBeenCalled();
    expect(user.save).not.toHaveBeenCalled();
  });

  test('does not allow a userId in the body to select another account', async () => {
    const { cookie } = await authenticatedUser();

    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Cookie', cookie)
      .send({ currentPassword: 'CurrentPass1', newPassword: 'NewPassword1', userId: 'u2' })
      .expect(400);

    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(User.findById).toHaveBeenCalledTimes(1);
    expect(User.findById).toHaveBeenCalledWith('u1');
  });
});

describe('AC4 - rate limiting on consecutive failed logins', () => {
  test('returns 429 after 10 consecutive failures and resets after a success', async () => {
    User.findOne.mockResolvedValue(makeUser());
    verifyPassword.mockResolvedValue(true);
    const ok = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@softwareone.com', password: 'RealPass1' });
    expect(ok.status).toBe(200);

    User.findOne.mockResolvedValue(null);
    for (let i = 0; i < 10; i += 1) {
      const r = await request(app)
        .post('/api/auth/login')
        .send({ email: 'admin@softwareone.com', password: 'BadPass1' });
      expect(r.status).toBe(401);
    }

    const limited = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@softwareone.com', password: 'BadPass1' })
      .expect(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
  });
});