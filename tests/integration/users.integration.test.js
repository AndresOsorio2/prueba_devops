process.env.JWT_SECRET = 'integration-secret-users';
process.env.TOKEN_EXPIRES_IN = '1h';
process.env.CORS_ORIGIN = 'http://localhost:8083';
process.env.NODE_ENV = 'test';
process.env.ALLOWED_EMAIL_DOMAINS = 'softwareone.com';

jest.mock('../../src/models/User', () => require('../mocks/mongooseModel')());
jest.mock('../../src/models/Event', () => require('../mocks/mongooseModel')());
jest.mock('../../src/services/passwordService', () => {
  const actual = jest.requireActual('../../src/services/passwordService');
  return {
    ...actual,
    verifyPassword: jest.fn(),
    validatePasswordPolicy: jest.fn(),
    hashPassword: jest.fn(),
    generateProvisionalPassword: jest.fn()
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
const { fullNameOf } = require('../../src/utils/userDisplay');
const {
  verifyPassword,
  validatePasswordPolicy,
  hashPassword,
  generateProvisionalPassword,
  PasswordPolicyError
} = require('../../src/services/passwordService');

const app = createApp();
const ADMIN_ID = '507f1f77bcf86cd799439011';
const ADMIN_EMAIL = 'admin@softwareone.com';
const TARGET_ID = '507f1f77bcf86cd799439012';

function makeUser(overrides = {}) {
  const data = {
    _id: ADMIN_ID,
    email: ADMIN_EMAIL,
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
      return { ...rest, fullName: fullNameOf(rest) };
    }
  };
  user.save.mockResolvedValue(user);
  return user;
}

function baseAdmin() {
  return makeUser({ email: ADMIN_EMAIL, permissions: ['users:write'] });
}

async function loginAs(user) {
  User.findOne.mockResolvedValue(user);
  verifyPassword.mockResolvedValue(true);
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: user.email, password: 'RealPass1' })
    .expect(200);
  return res.headers['set-cookie'][0].split(';')[0];
}

async function adminSession() {
  const cookie = await loginAs(baseAdmin());
  User.findById.mockResolvedValue(baseAdmin());
  return cookie;
}

beforeEach(() => {
  jest.clearAllMocks();
  User.create = jest.fn();
  validatePasswordPolicy.mockImplementation(() => {});
  hashPassword.mockResolvedValue('$2b$10$new-hash');
  generateProvisionalPassword.mockReturnValue('T68b4kPq9mVJlu');
  process.env.ALLOWED_EMAIL_DOMAINS = 'softwareone.com';
});

afterEach(() => {
  delete process.env.ALLOWED_EMAIL_DOMAINS;
});

describe('authentication on the users routes', () => {
  test('rejects the six routes with 401 without a session', async () => {
    await request(app).get('/api/users').expect(401);
    await request(app).post('/api/users').send({}).expect(401);
    await request(app)
      .patch(`/api/users/${TARGET_ID}/status`)
      .send({ active: false })
      .expect(401);
    await request(app)
      .patch(`/api/users/${TARGET_ID}`)
      .send({ jobTitle: 'Architect' })
      .expect(401);
    await request(app)
      .post(`/api/users/${TARGET_ID}/reset-password`)
      .expect(401);
    await request(app)
      .post('/api/users/import')
      .send({ users: [] })
      .expect(401);
  });
});

describe('authorization with users:write on the users routes', () => {
  test('rejects the six routes with 403 for a user without users:write', async () => {
    const viewer = makeUser({ email: 'viewer@softwareone.com', permissions: ['project:read'] });
    const cookie = await loginAs(viewer);
    User.findById.mockResolvedValue(viewer);

    const getRes = await request(app).get('/api/users').set('Cookie', cookie).expect(403);
    const postRes = await request(app)
      .post('/api/users')
      .set('Cookie', cookie)
      .send({ email: 'new@softwareone.com', password: 'Temporal1' })
      .expect(403);
    const patchRes = await request(app)
      .patch(`/api/users/${TARGET_ID}/status`)
      .set('Cookie', cookie)
      .send({ active: false })
      .expect(403);
    const profileRes = await request(app)
      .patch(`/api/users/${TARGET_ID}`)
      .set('Cookie', cookie)
      .send({ jobTitle: 'Architect' })
      .expect(403);
    const resetRes = await request(app)
      .post(`/api/users/${TARGET_ID}/reset-password`)
      .set('Cookie', cookie)
      .expect(403);
    const importRes = await request(app)
      .post('/api/users/import')
      .set('Cookie', cookie)
      .send({ users: [] })
      .expect(403);

    expect(getRes.body.error.code).toBe('FORBIDDEN');
    expect(postRes.body.error.code).toBe('FORBIDDEN');
    expect(patchRes.body.error.code).toBe('FORBIDDEN');
    expect(profileRes.body.error.code).toBe('FORBIDDEN');
    expect(resetRes.body.error.code).toBe('FORBIDDEN');
    expect(importRes.body.error.code).toBe('FORBIDDEN');
  });
});

describe('POST /api/users', () => {
  test('creates a valid user with server-controlled flags and responds 201', async () => {
    const cookie = await adminSession();
    const created = makeUser({ _id: TARGET_ID, email: 'new@softwareone.com', permissions: ['project:read'] });
    User.create.mockResolvedValue(created);

    const res = await request(app)
      .post('/api/users')
      .set('Cookie', cookie)
      .send({ email: 'new@softwareone.com', password: 'Temporal1', permissions: ['project:read'] })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.user.active).toBe(true);
    expect(res.body.data.user.mustChangePassword).toBe(true);
    expect(res.body.data.user.permissions).toEqual(['project:read']);
    expect(res.body.data.user.passwordHash).toBeUndefined();
    expect(User.create).toHaveBeenCalledWith(expect.objectContaining({
      email: 'new@softwareone.com',
      permissions: ['project:read'],
      active: true,
      mustChangePassword: true
    }));
  });

  test('returns 409 EMAIL_ALREADY_EXISTS on a duplicate email', async () => {
    const cookie = await adminSession();
    User.create.mockRejectedValue(Object.assign(new Error('duplicate'), { code: 11000 }));

    const res = await request(app)
      .post('/api/users')
      .set('Cookie', cookie)
      .send({ email: 'new@softwareone.com', password: 'Temporal1' })
      .expect(409);

    expect(res.body.error.code).toBe('EMAIL_ALREADY_EXISTS');
  });

  test('returns 400 EMAIL_DOMAIN_NOT_ALLOWED for a domain outside the configuration', async () => {
    const cookie = await adminSession();
    process.env.ALLOWED_EMAIL_DOMAINS = 'rimac.com';

    const res = await request(app)
      .post('/api/users')
      .set('Cookie', cookie)
      .send({ email: 'new@softwareone.com', password: 'Temporal1' })
      .expect(400);

    expect(res.body.error.code).toBe('EMAIL_DOMAIN_NOT_ALLOWED');
  });

  test('returns 400 VALIDATION_ERROR when the password violates the policy', async () => {
    const cookie = await adminSession();
    validatePasswordPolicy.mockImplementationOnce(() => {
      throw new PasswordPolicyError('La contraseña debe incluir un número', ['number']);
    });

    const res = await request(app)
      .post('/api/users')
      .set('Cookie', cookie)
      .send({ email: 'new@softwareone.com', password: 'weak' })
      .expect(400);

    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(hashPassword).not.toHaveBeenCalled();
  });
});

describe('GET /api/users', () => {
  test('lists users sorted by email without exposing passwordHash', async () => {
    const cookie = await adminSession();
    const users = [
      baseAdmin(),
      makeUser({ _id: TARGET_ID, email: 'b@softwareone.com' })
    ];
    User.find.mockReturnValue({ sort: jest.fn().mockResolvedValue(users) });

    const res = await request(app).get('/api/users').set('Cookie', cookie).expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data.every((user) => user.passwordHash === undefined)).toBe(true);
  });
});

describe('PATCH /api/users/:id/status', () => {
  async function sessionWithTargetUser(target) {
    const cookie = await adminSession();
    User.findById.mockImplementation((id) => {
      if (id === ADMIN_ID) return Promise.resolve(baseAdmin());
      return Promise.resolve(target);
    });
    return cookie;
  }

  test('changes active and responds 200 without passwordHash', async () => {
    const target = makeUser({ _id: TARGET_ID, email: 'b@softwareone.com' });
    const cookie = await sessionWithTargetUser(target);

    const res = await request(app)
      .patch(`/api/users/${TARGET_ID}/status`)
      .set('Cookie', cookie)
      .send({ active: false })
      .expect(200);

    expect(target.active).toBe(false);
    expect(target.save).toHaveBeenCalledTimes(1);
    expect(res.body.data.user.active).toBe(false);
    expect(res.body.data.user.passwordHash).toBeUndefined();
  });

  test('returns 404 when the user does not exist', async () => {
    const cookie = await sessionWithTargetUser(null);

    const res = await request(app)
      .patch(`/api/users/${TARGET_ID}/status`)
      .set('Cookie', cookie)
      .send({ active: false })
      .expect(404);

    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  test('returns 400 for a malformed id', async () => {
    const cookie = await adminSession();

    const res = await request(app)
      .patch('/api/users/not-an-object-id/status')
      .set('Cookie', cookie)
      .send({ active: false })
      .expect(400);

    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('PATCH /api/users/:id', () => {
  async function sessionWithTargetUser(target) {
    const cookie = await adminSession();
    User.findById.mockImplementation((id) => {
      if (id === ADMIN_ID) return Promise.resolve(baseAdmin());
      return Promise.resolve(target);
    });
    return cookie;
  }

  test('updates the profile fields and responds 200 with a derived fullName', async () => {
    const target = makeUser({ _id: TARGET_ID, email: 'b@softwareone.com' });
    const cookie = await sessionWithTargetUser(target);

    const res = await request(app)
      .patch(`/api/users/${TARGET_ID}`)
      .set('Cookie', cookie)
      .send({ firstName: 'Ana', lastName: 'Ruiz', jobTitle: 'Software Architect' })
      .expect(200);

    expect(target.firstName).toBe('Ana');
    expect(target.lastName).toBe('Ruiz');
    expect(target.jobTitle).toBe('Software Architect');
    expect(target.save).toHaveBeenCalledTimes(1);
    expect(res.body.data.user.fullName).toBe('Ana Ruiz');
    expect(res.body.data.user.passwordHash).toBeUndefined();
  });

  test('returns 400 when the body carries no profile field', async () => {
    const cookie = await adminSession();

    const res = await request(app)
      .patch(`/api/users/${TARGET_ID}`)
      .set('Cookie', cookie)
      .send({})
      .expect(400);

    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('returns 404 when the user does not exist', async () => {
    const cookie = await sessionWithTargetUser(null);

    const res = await request(app)
      .patch(`/api/users/${TARGET_ID}`)
      .set('Cookie', cookie)
      .send({ jobTitle: 'Architect' })
      .expect(404);

    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  test('returns 400 for a malformed id', async () => {
    const cookie = await adminSession();

    const res = await request(app)
      .patch('/api/users/not-an-object-id')
      .set('Cookie', cookie)
      .send({ jobTitle: 'Architect' })
      .expect(400);

    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('AC5 - disabling a user blocks access right away (feature 074)', () => {
  test('an inactive user cannot log in and receives 403 ACCOUNT_DISABLED', async () => {
    const victim = makeUser({
      _id: TARGET_ID,
      email: 'victim@softwareone.com',
      active: false,
      permissions: ['project:read']
    });
    User.findOne.mockResolvedValue(victim);
    verifyPassword.mockResolvedValue(true);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'victim@softwareone.com', password: 'RealPass1' })
      .expect(403);

    expect(res.body.error.code).toBe('ACCOUNT_DISABLED');
  });

  test('an already issued token stops working once the user is disabled', async () => {
    const victim = makeUser({
      _id: TARGET_ID,
      email: 'victim@softwareone.com',
      active: true,
      permissions: ['project:read']
    });
    const cookie = await loginAs(victim);
    User.findById.mockResolvedValue(makeUser({ ...victim, active: false }));

    const res = await request(app).get('/api/users').set('Cookie', cookie).expect(401);

    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });
});

describe('POST /api/users/:id/reset-password', () => {
  async function sessionWithTargetUser(target) {
    const cookie = await adminSession();
    User.findById.mockImplementation((id) => {
      if (id === ADMIN_ID) return Promise.resolve(baseAdmin());
      return Promise.resolve(target);
    });
    return cookie;
  }

  test('resets the password, forces mustChangePassword and delivers the provisional once', async () => {
    const target = makeUser({ _id: TARGET_ID, email: 'b@softwareone.com', mustChangePassword: false });
    const cookie = await sessionWithTargetUser(target);

    const res = await request(app)
      .post(`/api/users/${TARGET_ID}/reset-password`)
      .set('Cookie', cookie)
      .expect(200);

    expect(generateProvisionalPassword).toHaveBeenCalledTimes(1);
    expect(hashPassword).toHaveBeenCalledWith('T68b4kPq9mVJlu');
    expect(target.passwordHash).toBe('$2b$10$new-hash');
    expect(target.mustChangePassword).toBe(true);
    expect(target.save).toHaveBeenCalledTimes(1);
    expect(res.body.data.provisionalPassword).toBe('T68b4kPq9mVJlu');
    expect(res.body.data.user.mustChangePassword).toBe(true);
    expect(res.body.data.user.passwordHash).toBeUndefined();
    expect(res.body.data.user.provisionalPassword).toBeUndefined();
  });

  test('returns 404 when the user does not exist', async () => {
    const cookie = await sessionWithTargetUser(null);

    const res = await request(app)
      .post(`/api/users/${TARGET_ID}/reset-password`)
      .set('Cookie', cookie)
      .expect(404);

    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(generateProvisionalPassword).not.toHaveBeenCalled();
  });

  test('returns 400 for a malformed id', async () => {
    const cookie = await adminSession();

    const res = await request(app)
      .post('/api/users/not-an-object-id/reset-password')
      .set('Cookie', cookie)
      .expect(400);

    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/users/import', () => {
  test('returns 400 VALIDATION_ERROR when users is missing, not an array or has non-object rows', async () => {
    const cookie = await adminSession();

    const missing = await request(app)
      .post('/api/users/import')
      .set('Cookie', cookie)
      .send({})
      .expect(400);

    const notArray = await request(app)
      .post('/api/users/import')
      .set('Cookie', cookie)
      .send({ users: 'nope' })
      .expect(400);

    const nonObjectRow = await request(app)
      .post('/api/users/import')
      .set('Cookie', cookie)
      .send({ users: ['not-an-object'] })
      .expect(400);

    expect(missing.body.error.code).toBe('VALIDATION_ERROR');
    expect(notArray.body.error.code).toBe('VALIDATION_ERROR');
    expect(nonObjectRow.body.error.code).toBe('VALIDATION_ERROR');
    expect(User.create).not.toHaveBeenCalled();
  });

  test('returns 200 with an empty summary for an empty batch', async () => {
    const cookie = await adminSession();

    const res = await request(app)
      .post('/api/users/import')
      .set('Cookie', cookie)
      .send({ users: [] })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({ created: 0, rejected: [] });
    expect(User.find).not.toHaveBeenCalled();
  });

  test('creates valid rows with hashed passwords and reports the rest per row', async () => {
    const cookie = await adminSession();
    User.find.mockResolvedValue([{ email: 'b@softwareone.com' }]);
    validatePasswordPolicy.mockImplementation((password) => {
      if (typeof password !== 'string' || password.length < 8) {
        throw new PasswordPolicyError('La contraseña debe tener al menos 8 caracteres', ['length']);
      }
    });

    const payload = { users: [
      { email: 'a@softwareone.com', password: 'Temporal1', permissions: ['project:read'] },
      { email: 'A@SoftwareOne.com', password: 'Temporal2' },
      { email: 'b@softwareone.com', password: 'Temporal2' },
      { email: 'c@private.com', password: 'Temporal2' },
      { email: 'd@softwareone.com', password: 'short' },
      { email: 'e@softwareone.com' },
      { email: 'F@softwareone.com', password: 'Temporal3' }
    ] };

    const res = await request(app)
      .post('/api/users/import')
      .set('Cookie', cookie)
      .send(payload)
      .expect(200);

    expect(res.body.data.created).toBe(2);
    expect(res.body.data.rejected).toEqual([
      { row: 1, reason: 'EMAIL_ALREADY_EXISTS' },
      { row: 2, reason: 'EMAIL_ALREADY_EXISTS' },
      { row: 3, reason: 'EMAIL_DOMAIN_NOT_ALLOWED' },
      { row: 4, reason: 'VALIDATION_ERROR' },
      { row: 5, reason: 'VALIDATION_ERROR' }
    ]);

    expect(User.create).toHaveBeenCalledTimes(2);
    const createdEmails = User.create.mock.calls.map((call) => call[0].email);
    expect(createdEmails).toEqual(['a@softwareone.com', 'f@softwareone.com']);
    for (const call of User.create.mock.calls) {
      expect(call[0].passwordHash).toBe('$2b$10$new-hash');
      expect(call[0].password).toBeUndefined();
      expect(call[0].active).toBe(true);
      expect(call[0].mustChangePassword).toBe(true);
    }
    expect(User.create).toHaveBeenNthCalledWith(1, expect.objectContaining({
      email: 'a@softwareone.com',
      permissions: ['project:read']
    }));
    expect(User.create).toHaveBeenNthCalledWith(2, expect.objectContaining({
      email: 'f@softwareone.com',
      permissions: []
    }));
  });
});