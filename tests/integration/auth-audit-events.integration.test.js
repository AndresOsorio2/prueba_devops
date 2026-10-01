process.env.JWT_SECRET = 'integration-secret-audit';
process.env.TOKEN_EXPIRES_IN = '1h';
process.env.CORS_ORIGIN = 'http://localhost:8083';
process.env.NODE_ENV = 'test';
process.env.ALLOWED_EMAIL_DOMAINS = 'softwareone.com';

jest.mock('../../src/models/User', () => require('../mocks/mongooseModel')());
jest.mock('../../src/models/Project', () => require('../mocks/mongooseModel')());
jest.mock('../../src/models/Document', () => require('../mocks/mongooseModel')());
jest.mock('../../src/models/Rule', () => require('../mocks/mongooseModel')());
jest.mock('../../src/models/Evidence', () => require('../mocks/mongooseModel')());
jest.mock('../../src/models/Template', () => require('../mocks/mongooseModel')());
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
jest.mock('../../src/services/domainService', () => ({
  isEmailAllowed: jest.fn()
}));

const request = require('supertest');
const { createApp } = require('../../src/app');
const User = require('../../src/models/User');
const Project = require('../../src/models/Project');
const Event = require('../../src/models/Event');
const { verifyPassword, validatePasswordPolicy, hashPassword, generateProvisionalPassword } = require('../../src/services/passwordService');
const { isEmailAllowed } = require('../../src/services/domainService');

const app = createApp();
const ADMIN_ID = '507f1f77bcf86cd799439001';
const ADMIN_EMAIL = 'admin@softwareone.com';
const TARGET_ID = '507f1f77bcf86cd799439002';
const OTHER_ID = '507f1f77bcf86cd799439003';
const PROJECT_ID = '507f1f77bcf86cd799439004';

function makeUser(overrides = {}) {
  const data = {
    _id: ADMIN_ID,
    email: ADMIN_EMAIL,
    passwordHash: '$2b$10$hash',
    active: true,
    mustChangePassword: true,
    permissions: ['project:write', 'users:write', 'document:read', 'document:write', 'rule:read', 'rule:write', 'template:read', 'template:write'],
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

async function loginAdmin() {
  const admin = makeUser();
  User.findOne.mockResolvedValue(admin);
  verifyPassword.mockResolvedValue(true);
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: ADMIN_EMAIL, password: 'RealPass1' })
    .expect(200);
  User.findById.mockResolvedValue(admin);
  return res.headers['set-cookie'][0].split(';')[0];
}

function recordedEvents() {
  return (Event.mock.calls || []).map((call) => call[0]);
}

function lastEvent() {
  const events = recordedEvents();
  return events[events.length - 1];
}

beforeEach(() => {
  jest.clearAllMocks();
  isEmailAllowed.mockReturnValue(true);
  validatePasswordPolicy.mockImplementation(() => {});
  hashPassword.mockResolvedValue('$2b$10$new-hash');
  generateProvisionalPassword.mockReturnValue('T68b4kPq9mVJlu');
  User.find.mockResolvedValue([]);
  User.create = jest.fn();
  Project.findById.mockResolvedValue(new Project({ _id: PROJECT_ID, participants: [] }));
});

describe('user_login_succeeded / user_login_failed', () => {
  test('records user_login_succeeded without a projectId on a successful login', async () => {
    const admin = makeUser();
    User.findOne.mockResolvedValue(admin);
    verifyPassword.mockResolvedValue(true);

    await request(app)
      .post('/api/auth/login')
      .send({ email: ADMIN_EMAIL, password: 'RealPass1' })
      .expect(200);

    const event = lastEvent();
    expect(event.eventType).toBe('user_login_succeeded');
    expect(event.projectId).toBeUndefined();
    expect(event.payload).toEqual({ userId: ADMIN_ID, email: ADMIN_EMAIL });
  });

  test('records user_login_failed without a projectId for wrong password and unknown email', async () => {
    User.findOne.mockResolvedValueOnce(makeUser());
    verifyPassword.mockResolvedValueOnce(false);
    await request(app)
      .post('/api/auth/login')
      .send({ email: ADMIN_EMAIL, password: 'WrongPass1' })
      .expect(401);

    User.findOne.mockResolvedValueOnce(null);
    await request(app)
      .post('/api/auth/login')
      .send({ email: 'ghost@softwareone.com', password: 'Whatever1' })
      .expect(401);

    const events = recordedEvents();
    expect(events[0].eventType).toBe('user_login_failed');
    expect(events[0].projectId).toBeUndefined();
    expect(events[0].payload).toEqual({ email: ADMIN_EMAIL, userId: ADMIN_ID });
    expect(events[1].eventType).toBe('user_login_failed');
    expect(events[1].projectId).toBeUndefined();
    expect(events[1].payload).toEqual({ email: 'ghost@softwareone.com' });
  });

  test('records user_login_failed with the user id for a disabled account', async () => {
    User.findOne.mockResolvedValue(makeUser({ active: false }));

    await request(app)
      .post('/api/auth/login')
      .send({ email: ADMIN_EMAIL, password: 'RealPass1' })
      .expect(403);

    const event = lastEvent();
    expect(event.eventType).toBe('user_login_failed');
    expect(event.projectId).toBeUndefined();
    expect(event.payload).toEqual({ email: ADMIN_EMAIL, userId: ADMIN_ID });
  });
});

describe('user_password_changed', () => {
  test('records the event without a projectId after changing own password', async () => {
    const cookie = await loginAdmin();

    await request(app)
      .post('/api/auth/change-password')
      .set('Cookie', cookie)
      .send({ currentPassword: 'CurrentPass1', newPassword: 'NewPassword1' })
      .expect(200);

    const event = lastEvent();
    expect(event.eventType).toBe('user_password_changed');
    expect(event.projectId).toBeUndefined();
    expect(event.payload).toEqual({ userId: ADMIN_ID });
  });
});

describe('user management audit events', () => {
  test('records user_created without a projectId on user creation', async () => {
    const cookie = await loginAdmin();
    const created = makeUser({ _id: TARGET_ID, email: 'target@softwareone.com' });
    User.create.mockResolvedValue(created);

    await request(app)
      .post('/api/users')
      .set('Cookie', cookie)
      .send({ email: 'target@softwareone.com', password: 'Temporal1', permissions: [] })
      .expect(201);

    const event = lastEvent();
    expect(event.eventType).toBe('user_created');
    expect(event.projectId).toBeUndefined();
    expect(event.payload).toEqual({ userId: TARGET_ID, email: 'target@softwareone.com' });
  });

  test('records user_status_changed without a projectId when toggling active', async () => {
    const cookie = await loginAdmin();
    User.findById.mockResolvedValue(makeUser({ _id: TARGET_ID, email: 'target@softwareone.com' }));

    await request(app)
      .patch(`/api/users/${TARGET_ID}/status`)
      .set('Cookie', cookie)
      .send({ active: false })
      .expect(200);

    const event = lastEvent();
    expect(event.eventType).toBe('user_status_changed');
    expect(event.projectId).toBeUndefined();
    expect(event.payload).toEqual({ userId: TARGET_ID, email: 'target@softwareone.com', active: false });
  });

  test('records user_password_reset without a projectId on an admin reset', async () => {
    const cookie = await loginAdmin();
    User.findById.mockResolvedValue(makeUser({ _id: TARGET_ID, email: 'target@softwareone.com' }));

    await request(app)
      .post(`/api/users/${TARGET_ID}/reset-password`)
      .set('Cookie', cookie)
      .expect(200);

    const event = lastEvent();
    expect(event.eventType).toBe('user_password_reset');
    expect(event.projectId).toBeUndefined();
    expect(event.payload).toEqual({ userId: TARGET_ID, email: 'target@softwareone.com' });
  });

  test('records one user_created event per user created by the bulk import', async () => {
    const cookie = await loginAdmin();
    User.create.mockResolvedValue({ _id: 'imported-1', email: 'imported@softwareone.com' });

    const res = await request(app)
      .post('/api/users/import')
      .set('Cookie', cookie)
      .send({ users: [{ email: 'imported@softwareone.com', password: 'Temporal1' }] })
      .expect(200);

    expect(res.body.data.created).toBe(1);
    const events = recordedEvents().filter((event) => event.eventType === 'user_created');
    expect(events).toHaveLength(1);
    expect(events[0].projectId).toBeUndefined();
    expect(events[0].payload).toEqual({ userId: 'imported-1', email: 'imported@softwareone.com' });
  });
});

describe('project participant audit events', () => {
  test('records project_participant_added with the projectId', async () => {
    const cookie = await loginAdmin();
    Project.findById.mockResolvedValue(new Project({ _id: PROJECT_ID, participants: [] }));

    await request(app)
      .post(`/api/projects/${PROJECT_ID}/participants`)
      .set('Cookie', cookie)
      .send({ userIds: [TARGET_ID] })
      .expect(200);

    const event = lastEvent();
    expect(event.eventType).toBe('project_participant_added');
    expect(event.projectId).toBe(PROJECT_ID);
    expect(event.payload).toEqual({ participants: [TARGET_ID] });
  });

  test('records project_participant_removed with the projectId', async () => {
    const cookie = await loginAdmin();
    Project.findById.mockResolvedValue(new Project({ _id: PROJECT_ID, participants: [TARGET_ID, OTHER_ID] }));

    await request(app)
      .delete(`/api/projects/${PROJECT_ID}/participants/${OTHER_ID}`)
      .set('Cookie', cookie)
      .expect(200);

    const event = lastEvent();
    expect(event.eventType).toBe('project_participant_removed');
    expect(event.projectId).toBe(PROJECT_ID);
    expect(event.payload).toEqual({ userId: OTHER_ID });
  });
});