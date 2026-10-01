jest.mock('../../src/models/User', () => ({ findOne: jest.fn(), create: jest.fn() }));
jest.mock('mongoose', () => ({
  connect: jest.fn().mockResolvedValue('connection'),
  disconnect: jest.fn().mockResolvedValue(undefined)
}));
jest.mock('../../src/services/passwordService', () => ({
  hashPassword: jest.fn((password) => Promise.resolve(`hashed:${password}`)),
  generateProvisionalPassword: jest.fn(() => 'ProvisionalPass123'),
  BCRYPT_ROUNDS: 10
}));

const User = require('../../src/models/User');
const mongoose = require('mongoose');
const { hashPassword, generateProvisionalPassword } = require('../../src/services/passwordService');
const { seedAdmin, run, SEED_ADMIN_EMAIL } = require('../../src/seed');
const { ALL_PERMISSIONS } = require('../../src/models/permissions');

describe('seedAdmin', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('creates the admin user when it does not exist', async () => {
    User.findOne.mockResolvedValue(null);
    User.create.mockImplementation(async (data) => ({ ...data, _id: 'fake-id' }));

    const result = await seedAdmin();

    expect(User.findOne).toHaveBeenCalledWith({ email: SEED_ADMIN_EMAIL });
    expect(generateProvisionalPassword).toHaveBeenCalledTimes(1);
    expect(hashPassword).toHaveBeenCalledWith('ProvisionalPass123');
    expect(User.create).toHaveBeenCalledTimes(1);
    const created = User.create.mock.calls[0][0];
    expect(created.email).toBe(SEED_ADMIN_EMAIL);
    expect(created.active).toBe(true);
    expect(created.mustChangePassword).toBe(true);
    expect(created.permissions).toEqual(ALL_PERMISSIONS);
    expect(created.provider).toBe('local');
    expect(result.status).toBe('created');
    expect(result.provisional).toBe('ProvisionalPass123');
    expect(created.passwordHash).toBe('hashed:ProvisionalPass123');
    expect(created.passwordHash).not.toBe(result.provisional);
  });

  test('leaves the admin intact when it already exists', async () => {
    User.findOne.mockResolvedValue({ _id: 'existing', email: SEED_ADMIN_EMAIL });

    const result = await seedAdmin();

    expect(User.findOne).toHaveBeenCalledWith({ email: SEED_ADMIN_EMAIL });
    expect(generateProvisionalPassword).not.toHaveBeenCalled();
    expect(hashPassword).not.toHaveBeenCalled();
    expect(User.create).not.toHaveBeenCalled();
    expect(result).toEqual({ status: 'exists', email: SEED_ADMIN_EMAIL });
  });

  test('run() connects to Mongo, seeds and disconnects', async () => {
    User.findOne.mockResolvedValue({ _id: 'existing', email: SEED_ADMIN_EMAIL });

    await run();

    expect(mongoose.connect).toHaveBeenCalled();
    expect(User.findOne).toHaveBeenCalledWith({ email: SEED_ADMIN_EMAIL });
    expect(mongoose.disconnect).toHaveBeenCalled();
  });
});