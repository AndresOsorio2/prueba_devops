jest.mock('crypto', () => {
  const actual = jest.requireActual('crypto');
  return { ...actual, randomBytes: jest.fn(actual.randomBytes) };
});

const crypto = require('crypto');
const {
  hashPassword,
  verifyPassword,
  validatePasswordPolicy,
  generateProvisionalPassword,
  PasswordPolicyError,
  PASSWORD_POLICY,
  BCRYPT_ROUNDS
} = require('../../src/services/passwordService');

beforeEach(() => {
  crypto.randomBytes.mockClear();
  crypto.randomBytes.mockImplementation(jest.requireActual('crypto').randomBytes);
});

describe('PASSWORD_POLICY config', () => {
  test('enforces minimum length of 8 with basic complexity', () => {
    expect(PASSWORD_POLICY).toEqual({
      MIN_LENGTH: 8,
      REQUIRE_UPPERCASE: true,
      REQUIRE_LOWERCASE: true,
      REQUIRE_NUMBER: true
    });
  });

  test('uses 10 bcrypt rounds', () => {
    expect(BCRYPT_ROUNDS).toBe(10);
  });
});

describe('hashPassword', () => {
  test('returns a bcrypt hash with salt, never the plain password', async () => {
    const hash = await hashPassword('MiPassword123');
    expect(hash).toBeTruthy();
    expect(hash).not.toContain('MiPassword123');
    expect(hash.startsWith('$2b$')).toBe(true);
  });

  test('uses the configured number of rounds', async () => {
    const hash = await hashPassword('MiPassword123');
    expect(Number(hash.split('$')[2])).toBe(BCRYPT_ROUNDS);
  });

  test('produces distinct hashes for the same password (unique salt)', async () => {
    const [first, second] = await Promise.all([
      hashPassword('MiPassword123'),
      hashPassword('MiPassword123')
    ]);
    expect(first).not.toBe(second);
  });
});

describe('verifyPassword', () => {
  test('returns true when the password matches the hash', async () => {
    const hash = await hashPassword('MiPassword123');
    expect(await verifyPassword('MiPassword123', hash)).toBe(true);
  });

  test('returns false when the password does not match', async () => {
    const hash = await hashPassword('MiPassword123');
    expect(await verifyPassword('wrong-password', hash)).toBe(false);
  });

  test('returns false (does not throw) when the hash is a malformed string', async () => {
    expect(await verifyPassword('MiPassword123', 'not-a-valid-bcrypt-hash')).toBe(false);
  });

  test('returns false (does not throw) when hash or password arguments are invalid', async () => {
    await expect(verifyPassword('MiPassword123', undefined)).resolves.toBe(false);
    await expect(verifyPassword('MiPassword123', null)).resolves.toBe(false);
  });
});

describe('PasswordPolicyError', () => {
  test('defaults the missing array to empty', () => {
    const error = new PasswordPolicyError('msg');
    expect(error.message).toBe('msg');
    expect(error.name).toBe('PasswordPolicyError');
    expect(error.missing).toEqual([]);
  });
});

describe('validatePasswordPolicy', () => {
  test.each([
    ['MiPassword123'],
    ['aB3defgh'],
    ['Longitud1Exacta8']
  ])('accepts a valid password (%p)', (password) => {
    expect(() => validatePasswordPolicy(password)).not.toThrow();
  });

  test('rejects short passwords with a clear message', () => {
    expect(() => validatePasswordPolicy('Ab1')).toThrowError(
      /La contraseña debe incluir al menos 8 caracteres/
    );
  });

  test('rejects passwords without an uppercase letter', () => {
    expect(() => validatePasswordPolicy('mipassword123')).toThrowError(/una mayúscula/);
  });

  test('rejects passwords without a lowercase letter', () => {
    expect(() => validatePasswordPolicy('MIPASSWORD123')).toThrowError(/una minúscula/);
  });

  test('rejects passwords without a number', () => {
    expect(() => validatePasswordPolicy('MiPassword')).toThrowError(/un número/);
  });

  test('reports every missing requirement in the message and the missing array', () => {
    let error;
    try {
      validatePasswordPolicy('****');
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(PasswordPolicyError);
    expect(error.name).toBe('PasswordPolicyError');
    expect(error.message).toContain('al menos 8 caracteres');
    expect(error.message).toContain('una mayúscula');
    expect(error.message).toContain('una minúscula');
    expect(error.message).toContain('un número');
    expect(error.missing).toEqual(['length', 'uppercase', 'lowercase', 'number']);
  });

  test('rejects a non-string value', () => {
    expect(() => validatePasswordPolicy(123456)).toThrowError(/debe ser un texto/);
  });
});

describe('generateProvisionalPassword', () => {
  test('returns a string meeting the minimum length', () => {
    const provisional = generateProvisionalPassword();
    expect(typeof provisional).toBe('string');
    expect(provisional.length).toBeGreaterThanOrEqual(PASSWORD_POLICY.MIN_LENGTH);
  });

  test('always satisfies the password policy', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(() => validatePasswordPolicy(generateProvisionalPassword())).not.toThrow();
    }
  });

  test('includes each required character class', () => {
    const provisional = generateProvisionalPassword();
    expect(/[A-Z]/.test(provisional)).toBe(true);
    expect(/[a-z]/.test(provisional)).toBe(true);
    expect(/[0-9]/.test(provisional)).toBe(true);
  });

  test('forces a lowercase prefix when the random material has no lowercase letter', () => {
    crypto.randomBytes.mockReturnValue(Buffer.alloc(12));
    expect(generateProvisionalPassword()).toBe('aAAAAAAAAAAAAAAAA1');
  });

  test('forces an uppercase prefix when the random material has no uppercase letter', () => {
    crypto.randomBytes.mockReturnValue(Buffer.from([222, 89, 37, 154, 90, 62, 118, 247, 188, 146, 86, 231]));
    expect(generateProvisionalPassword()).toBe('A3lklmlo-dve8klbn');
  });

  test('appends a digit when the random material has no number', () => {
    crypto.randomBytes.mockReturnValue(Buffer.from('aaaaaaaaaaaa'));
    expect(generateProvisionalPassword()).toBe('YWFhYWFhYWFhYWFh1');
  });
});