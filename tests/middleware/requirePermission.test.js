const { requirePermission, hasPermission, InvalidPermissionError } = require('../../src/middleware/requirePermission');
const { PERMISSIONS, ALL_PERMISSIONS } = require('../../src/models/permissions');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('catálogo (AC1)', () => {
  test('PERMISSIONS is exactly the 13 valid permissions', () => {
    expect(PERMISSIONS).toEqual([
      'project:read', 'project:write', 'project:members',
      'document:read', 'document:write', 'document:responsible',
      'rule:read', 'rule:write',
      'evidence:read', 'evidence:write',
      'template:read', 'template:write',
      'users:write'
    ]);
    expect(PERMISSIONS).toHaveLength(13);
  });

  test('ALL_PERMISSIONS is a copy of PERMISSIONS (same content, distinct array)', () => {
    expect(ALL_PERMISSIONS).toEqual(PERMISSIONS);
    expect(ALL_PERMISSIONS).not.toBe(PERMISSIONS);
  });

  test.each([
    'project:members',
    'document:responsible',
    'evidence:read',
    'evidence:write'
  ])('the new %s resolves without InvalidPermissionError (D-056, D-073)', (permission) => {
    expect(PERMISSIONS).toContain(permission);
    expect(hasPermission({ permissions: [permission] }, permission)).toBe(true);
    expect(() => hasPermission({ permissions: PERMISSIONS }, permission)).not.toThrow();
  });
});

describe('requirePermission', () => {
  test.each(PERMISSIONS.map((permission) => [permission]))(
    'calls next() when the user has %s',
    (permission) => {
      const req = { user: { permissions: [permission] } };
      const res = mockRes();
      const next = jest.fn();

      requirePermission(permission)(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    }
  );

  test.each(PERMISSIONS.map((permission) => [permission]))(
    'responds 403 FORBIDDEN when the user lacks %s',
    (permission) => {
      const req = { user: { permissions: [] } };
      const res = mockRes();
      const next = jest.fn();

      requirePermission(permission)(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: { code: 'FORBIDDEN', message: `Permiso requerido: ${permission}` }
      });
      expect(next).not.toHaveBeenCalled();
    }
  );

  test('enforces strict inclusion (a different permission is not enough)', () => {
    const req = { user: { permissions: ['users:write'] } };
    const res = mockRes();
    const next = jest.fn();

    requirePermission('project:write')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('responds 401 UNAUTHORIZED when there is no req.user (AC4)', () => {
    const req = {};
    const res = mockRes();
    const next = jest.fn();

    requirePermission('project:read')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Autenticación requerida' }
    });
    expect(next).not.toHaveBeenCalled();
  });

  test.each([
    [{ user: {} }],
    [{ user: { permissions: undefined } }],
    [{ user: { permissions: null } }],
    [{ user: { permissions: 'project:read' } }]
  ])('responds 403 when permissions is missing or not an array (%o)', (req) => {
    const res = mockRes();
    const next = jest.fn();

    requirePermission('project:read')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('throws InvalidPermissionError at factory time for a permission outside the catalog', () => {
    expect(() => requirePermission('project:delete')).toThrow(InvalidPermissionError);
    expect(() => requirePermission('project:delete')).toThrow(/no está en el catálogo/);
    expect(() => requirePermission(null)).toThrow(InvalidPermissionError);
    expect(() => requirePermission(undefined)).toThrow(InvalidPermissionError);
  });
});

describe('hasPermission', () => {
  test.each(PERMISSIONS.map((permission) => [permission]))(
    'returns true for a granted %s',
    (permission) => {
      expect(hasPermission({ permissions: [permission] }, permission)).toBe(true);
      expect(hasPermission({ permissions: PERMISSIONS }, permission)).toBe(true);
    }
  );

  test.each(PERMISSIONS.map((permission) => [permission]))(
    'returns false for a missing %s',
    (permission) => {
      expect(hasPermission({ permissions: [] }, permission)).toBe(false);
    }
  );

  test('returns false for a null or undefined user', () => {
    expect(hasPermission(null, 'project:read')).toBe(false);
    expect(hasPermission(undefined, 'project:read')).toBe(false);
  });

  test.each([
    [{}],
    [{ permissions: undefined }],
    [{ permissions: null }],
    [{ permissions: 'project:read' }]
  ])('returns false when permissions is missing or not an array (%o)', (user) => {
    expect(hasPermission(user, 'project:read')).toBe(false);
  });

  test('throws InvalidPermissionError for a permission outside the catalog', () => {
    expect(() => hasPermission({ permissions: PERMISSIONS }, 'project:delete')).toThrow(InvalidPermissionError);
    expect(() => hasPermission({ permissions: PERMISSIONS }, '')).toThrow(InvalidPermissionError);
  });
});