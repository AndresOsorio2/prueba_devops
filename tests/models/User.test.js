const User = require('../../src/models/User');
const { PERMISSIONS } = require('../../src/models/permissions');

const base = {
  email: 'Admin@SoftwareOne.com',
  passwordHash: 'hashed-password'
};

describe('User schema', () => {
  test('requires a unique lowercased email', () => {
    const path = User.schema.path('email');
    expect(path.isRequired).toBe(true);
    expect(path.options.unique).toBe(true);
    expect(path.options.lowercase).toBe(true);
    expect(path.options.trim).toBe(true);
  });

  test('normalizes stored emails to lowercase', () => {
    const user = new User(base);
    expect(user.email).toBe('admin@softwareone.com');
  });

  test('requires passwordHash', () => {
    expect(User.schema.path('passwordHash').isRequired).toBe(true);
  });

  test('active defaults to true', () => {
    expect(User.schema.path('active').options.default).toBe(true);
    expect(new User(base).active).toBe(true);
  });

  test('mustChangePassword defaults to true', () => {
    expect(User.schema.path('mustChangePassword').options.default).toBe(true);
    expect(new User(base).mustChangePassword).toBe(true);
  });

  test('permissions default to empty array', () => {
    expect(User.schema.path('permissions').options.default).toEqual([]);
    expect(new User(base).permissions).toEqual([]);
  });

  test('accepts catalog permissions', () => {
    const user = new User({ ...base, permissions: ['project:read', 'users:write'] });
    expect(user.validateSync()).toBeUndefined();
  });

  test('rejects permissions outside the catalog', () => {
    const user = new User({ ...base, permissions: ['admin:*'] });
    const err = user.validateSync();
    expect(err.errors.permissions).toBeDefined();
  });

  test('permissions validator aligns with the central catalog', () => {
    const validator = User.schema.path('permissions').validators[0].validator;
    expect(validator(PERMISSIONS)).toBe(true);
    expect(validator(['unknown:read'])).toBe(false);
  });

  // D-007: el validador hace spread del catalogo, asi que ampliarlo no exige editar el model.
  // Estos tests fijan esa propagacion como invariante.
  test('permissions validator accepts the full catalog of 13', () => {
    const validator = User.schema.path('permissions').validators[0].validator;
    expect(PERMISSIONS).toHaveLength(13);
    expect(validator([...PERMISSIONS])).toBe(true);
  });

  test.each(['project:members', 'document:responsible', 'evidence:read', 'evidence:write'])(
    'permissions validator accepts the new permission %s',
    (permission) => {
      const validator = User.schema.path('permissions').validators[0].validator;
      expect(validator([permission])).toBe(true);
    }
  );

  test('a stored user with the legacy catalog of 9 is still valid after the expansion', () => {
    const legacy = [
      'project:read', 'project:write', 'document:read', 'document:write',
      'rule:read', 'rule:write', 'template:read', 'template:write', 'users:write'
    ];
    const user = new User({ ...base, permissions: legacy });
    expect(user.validateSync()).toBeUndefined();
  });

  test('provider defaults to local and restricts to local/microsoft', () => {
    const path = User.schema.path('provider');
    expect(path.options.default).toBe('local');
    expect(path.enumValues).toEqual(['local', 'microsoft']);
    expect(new User(base).provider).toBe('local');
  });

  test('externalId is optional', () => {
    expect(User.schema.path('externalId').options.required).toBeUndefined();
    expect(new User(base).externalId).toBeNull();
  });

  test('excludes passwordHash from toJSON', () => {
    const user = new User(base);
    const json = user.toJSON();
    expect(json.passwordHash).toBeUndefined();
    expect(json.email).toBe('admin@softwareone.com');
  });

  test('excludes passwordHash from toObject', () => {
    const user = new User(base);
    const obj = user.toObject();
    expect(obj.passwordHash).toBeUndefined();
  });
});

describe('User profile fields', () => {
  test.each(['firstName', 'lastName', 'jobTitle'])('%s is optional and defaults to null', (field) => {
    const path = User.schema.path(field);
    expect(path.isRequired).toBeFalsy();
    expect(path.options.required).toBeUndefined();
    expect(path.options.default).toBeNull();
    expect(new User(base)[field]).toBeNull();
  });

  test.each(['firstName', 'lastName', 'jobTitle'])('%s trims its value', (field) => {
    expect(User.schema.path(field).options.trim).toBe(true);
  });

  test('persists the three profile fields when provided', () => {
    const user = new User({ ...base, firstName: 'Ana', lastName: 'Ruiz', jobTitle: 'Software Architect' });
    expect(user.validateSync()).toBeUndefined();
    expect(user.firstName).toBe('Ana');
    expect(user.lastName).toBe('Ruiz');
    expect(user.jobTitle).toBe('Software Architect');
  });

  test('toJSON derives fullName from the stored name', () => {
    const user = new User({ ...base, firstName: 'Ana', lastName: 'Ruiz' });
    expect(user.toJSON().fullName).toBe('Ana Ruiz');
  });

  test('toJSON derives fullName from a single name', () => {
    expect(new User({ ...base, firstName: 'Ana' }).toJSON().fullName).toBe('Ana');
    expect(new User({ ...base, lastName: 'Ruiz' }).toJSON().fullName).toBe('Ruiz');
  });

  test('toJSON falls back to the email for a user without a name', () => {
    expect(new User(base).toJSON().fullName).toBe('admin@softwareone.com');
  });

  test('toObject derives fullName too', () => {
    const user = new User({ ...base, firstName: 'Ana', lastName: 'Ruiz' });
    expect(user.toObject().fullName).toBe('Ana Ruiz');
  });

  test('deriving fullName does not persist it on the document', () => {
    const user = new User({ ...base, firstName: 'Ana', lastName: 'Ruiz' });
    user.toJSON();
    expect(user.fullName).toBeUndefined();
    expect(User.schema.path('fullName')).toBeUndefined();
  });
});