jest.mock('../../src/models/User', () => ({
  find: jest.fn(),
  updateOne: jest.fn()
}));
jest.mock('mongoose', () => ({
  connect: jest.fn().mockResolvedValue('connection'),
  disconnect: jest.fn().mockResolvedValue(undefined)
}));

const User = require('../../src/models/User');
const mongoose = require('mongoose');
const {
  LEGACY_PERMISSIONS,
  NEW_PERMISSIONS,
  missingNewPermissions,
  mergePermissions,
  parseArgs,
  backfill,
  run
} = require('../../scripts/backfill-permissions');
const { PERMISSIONS, ALL_PERMISSIONS } = require('../../src/models/permissions');

const silent = { log: () => {} };

function findReturning(users) {
  return {
    select: () => ({ lean: async () => users })
  };
}

describe('catalogo de referencia del backfill (D-002)', () => {
  test('LEGACY_PERMISSIONS son los 9 anteriores, congelados y en su orden', () => {
    expect(LEGACY_PERMISSIONS).toEqual([
      'project:read', 'project:write',
      'document:read', 'document:write',
      'rule:read', 'rule:write',
      'template:read', 'template:write',
      'users:write'
    ]);
    expect(LEGACY_PERMISSIONS).toHaveLength(9);
  });

  test('LEGACY_PERMISSIONS es un subconjunto estricto del catalogo vigente', () => {
    expect(LEGACY_PERMISSIONS.every((permission) => PERMISSIONS.includes(permission))).toBe(true);
    expect(LEGACY_PERMISSIONS).not.toEqual(PERMISSIONS);
  });

  test('NEW_PERMISSIONS son los 4 nuevos y son el complemento exacto', () => {
    expect(NEW_PERMISSIONS).toEqual([
      'project:members',
      'evidence:read', 'evidence:write',
      'document:responsible'
    ]);
    expect(ALL_PERMISSIONS).toEqual([...LEGACY_PERMISSIONS, ...NEW_PERMISSIONS].sort(
      (a, b) => PERMISSIONS.indexOf(a) - PERMISSIONS.indexOf(b)
    ));
  });
});

describe('missingNewPermissions (D-001)', () => {
  test('amplia a quien tiene el catalogo completo de 9', () => {
    expect(missingNewPermissions([...LEGACY_PERMISSIONS])).toEqual(
      expect.arrayContaining(NEW_PERMISSIONS)
    );
    expect(missingNewPermissions([...LEGACY_PERMISSIONS])).toHaveLength(4);
  });

  test('no toca a quien tiene un subconjunto', () => {
    expect(missingNewPermissions(['project:read', 'project:write'])).toEqual([]);
    expect(missingNewPermissions([])).toEqual([]);
    expect(missingNewPermissions([...LEGACY_PERMISSIONS].slice(0, 8))).toEqual([]);
  });

  test('es idempotente: con los 13 ya no propone nada', () => {
    expect(missingNewPermissions([...ALL_PERMISSIONS])).toEqual([]);
    expect(missingNewPermissions([...LEGACY_PERMISSIONS, 'evidence:read'])).toEqual([
      'project:members', 'evidence:write', 'document:responsible'
    ]);
  });

  test('tolera permisos ausentes o no-array', () => {
    expect(missingNewPermissions(undefined)).toEqual([]);
    expect(missingNewPermissions(null)).toEqual([]);
    expect(missingNewPermissions('project:read')).toEqual([]);
  });

  test('el orden de permisos guardados no altera el resultado', () => {
    const shuffled = [...LEGACY_PERMISSIONS].reverse();
    expect(missingNewPermissions(shuffled)).toHaveLength(4);
  });
});

describe('mergePermissions', () => {
  test('agrega sin duplicar y respeta el orden existente', () => {
    expect(mergePermissions([...LEGACY_PERMISSIONS], NEW_PERMISSIONS)).toEqual(
      expect.arrayContaining(NEW_PERMISSIONS)
    );
    expect(mergePermissions([...LEGACY_PERMISSIONS], NEW_PERMISSIONS)).toHaveLength(13);
  });

  test('no duplica si el permiso ya estaba', () => {
    expect(mergePermissions([...LEGACY_PERMISSIONS, 'evidence:read'], ['evidence:read'])).toHaveLength(10);
  });

  test('tolera un valor no-array', () => {
    expect(mergePermissions(undefined, ['evidence:read'])).toEqual(['evidence:read']);
  });
});

describe('parseArgs (D-003)', () => {
  test('sin argumentos es solo lectura', () => {
    expect(parseArgs([])).toEqual({ apply: false, dryRun: true });
  });

  test('--apply habilita la escritura', () => {
    expect(parseArgs(['--apply'])).toEqual({ apply: true, dryRun: false });
  });

  test('--dry-run explicito es equivalente al default', () => {
    expect(parseArgs(['--dry-run'])).toEqual({ apply: false, dryRun: true });
  });

  test('rechaza --apply junto a --dry-run', () => {
    expect(() => parseArgs(['--apply', '--dry-run'])).toThrow();
  });
});

describe('backfill', () => {
  beforeEach(() => jest.clearAllMocks());

  test('no escribe sin apply', async () => {
    User.find.mockReturnValue(findReturning([
      { _id: '1', email: 'admin@softwareone.com', permissions: [...LEGACY_PERMISSIONS] }
    ]));
    const report = await backfill({ apply: false, log: silent.log });

    expect(User.updateOne).not.toHaveBeenCalled();
    expect(report.scanned).toBe(1);
    expect(report.updated).toBe(1);
    expect(report.details[0].added).toEqual(expect.arrayContaining(NEW_PERMISSIONS));
  });

  test('escribe los 13 con apply', async () => {
    User.find.mockReturnValue(findReturning([
      { _id: '1', email: 'admin@softwareone.com', permissions: [...LEGACY_PERMISSIONS] }
    ]));
    await backfill({ apply: true, log: silent.log });

    expect(User.updateOne).toHaveBeenCalledTimes(1);
    const [, update] = User.updateOne.mock.calls[0];
    expect(update.$set.permissions).toHaveLength(13);
    expect(update.$set.permissions).toEqual(expect.arrayContaining(NEW_PERMISSIONS));
  });

  test('la segunda corrida no cambia nada (idempotencia)', async () => {
    User.find.mockReturnValue(findReturning([
      { _id: '1', email: 'admin@softwareone.com', permissions: [...ALL_PERMISSIONS] }
    ]));
    const report = await backfill({ apply: true, log: silent.log });

    expect(User.updateOne).not.toHaveBeenCalled();
    expect(report.updated).toBe(0);
    expect(report.unchanged).toBe(1);
  });

  test('omite a los usuarios con catalogo parcial y los cuenta aparte', async () => {
    User.find.mockReturnValue(findReturning([
      { _id: '1', email: 'admin@softwareone.com', permissions: [...LEGACY_PERMISSIONS] },
      { _id: '2', email: 'lector@softwareone.com', permissions: ['project:read', 'document:read'] }
    ]));
    const report = await backfill({ apply: true, log: silent.log });

    expect(User.updateOne).toHaveBeenCalledTimes(1);
    expect(User.updateOne.mock.calls[0][0]).toEqual({ _id: '1' });
    expect(report.updated).toBe(1);
    expect(report.skipped).toBe(1);
  });

  test('un usuario ya ampliado a la mitad se completa', async () => {
    User.find.mockReturnValue(findReturning([
      { _id: '1', email: 'admin@softwareone.com', permissions: [...LEGACY_PERMISSIONS, 'evidence:read'] }
    ]));
    const report = await backfill({ apply: true, log: silent.log });

    expect(report.details[0].added).not.toContain('evidence:read');
    expect(report.details[0].added).toHaveLength(3);
  });
});


describe('run (punto de entrada por CLI)', () => {
  let logSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    process.env.MONGODB_URI = 'mongodb://user:secret@localhost:27018/db';
  });

  afterEach(() => logSpy.mockRestore());

  const output = () => logSpy.mock.calls.map((call) => String(call[0])).join('\n');

  test('sin --apply anuncia el modo simulado y no escribe', async () => {
    User.find.mockReturnValue(findReturning([
      { _id: '1', email: 'admin@softwareone.com', permissions: [...LEGACY_PERMISSIONS] }
    ]));

    const report = await run([]);

    expect(mongoose.connect).toHaveBeenCalled();
    expect(User.updateOne).not.toHaveBeenCalled();
    expect(output()).toContain('SIMULADO');
    expect(output()).toContain('Reejecuta con --apply');
    expect(report.updated).toBe(1);
  });

  test('con --apply anuncia el modo aplicado y escribe', async () => {
    User.find.mockReturnValue(findReturning([
      { _id: '1', email: 'admin@softwareone.com', permissions: [...LEGACY_PERMISSIONS] }
    ]));

    await run(['--apply']);

    expect(User.updateOne).toHaveBeenCalledTimes(1);
    expect(output()).toContain('APLICANDO');
  });

  test('enmascara las credenciales de la URI en la salida', async () => {
    User.find.mockReturnValue(findReturning([]));

    await run([]);

    expect(output()).toContain('//***@localhost:27018');
    expect(output()).not.toContain('secret');
  });

  test('cierra la conexion incluso si la ejecucion falla', async () => {
    User.find.mockImplementation(() => { throw new Error('boom'); });

    await expect(run([])).rejects.toThrow('boom');
    expect(mongoose.disconnect).toHaveBeenCalled();
  });

  test('propaga el error de argumentos contradictorios sin conectar', async () => {
    await expect(run(['--apply', '--dry-run'])).rejects.toThrow();
    expect(mongoose.connect).not.toHaveBeenCalled();
  });
});
