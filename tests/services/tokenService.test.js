const jwt = require('jsonwebtoken');
const {
  COOKIE_NAME,
  DEFAULT_TOKEN_EXPIRES_IN,
  signToken,
  verifyToken,
  buildCookieOptions
} = require('../../src/services/tokenService');

const SECRET = 'test-secret-rimac';

beforeEach(() => {
  process.env.JWT_SECRET = SECRET;
  delete process.env.TOKEN_EXPIRES_IN;
});

afterEach(() => {
  delete process.env.JWT_SECRET;
  delete process.env.TOKEN_EXPIRES_IN;
  delete process.env.NODE_ENV;
  jest.restoreAllMocks();
});

describe('tokenService constants', () => {
  test('exposes the httpOnly cookie name used across auth', () => {
    expect(COOKIE_NAME).toBe('dm_token');
  });

  test('defaults token expiry to 8h', () => {
    expect(DEFAULT_TOKEN_EXPIRES_IN).toBe('8h');
  });
});

describe('signToken / verifyToken', () => {
  test('roundtrip returns a payload with string sub and future exp', async () => {
    const token = await signToken('u42');
    const payload = await verifyToken(token);
    expect(payload.sub).toBe('u42');
    expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  test('uses TOKEN_EXPIRES_IN when configured', async () => {
    process.env.TOKEN_EXPIRES_IN = '1h';
    const token = await signToken('u1');
    const payload = await verifyToken(token);
    const now = Math.floor(Date.now() / 1000);
    expect(payload.exp - now).toBeLessThanOrEqual(3600 + 60);
    expect(payload.exp - now).toBeGreaterThan(3590);
  });

  test('rejects an invalid token', async () => {
    await expect(verifyToken('not-a-jwt')).rejects.toThrow();
  });

  test('rejects an expired token', async () => {
    const token = jwt.sign({ sub: 'u1' }, SECRET, { expiresIn: 1 });
    const realNow = Date.now;
    jest.spyOn(Date, 'now').mockReturnValue(realNow() + 2 * 3600 * 1000);
    await expect(verifyToken(token)).rejects.toThrow('expired');
  });

  test('throws a config error when JWT_SECRET is missing', async () => {
    delete process.env.JWT_SECRET;
    await expect(signToken('u1')).rejects.toThrow(/JWT_SECRET/);
    await expect(verifyToken('x')).rejects.toThrow(/JWT_SECRET/);
  });
});

describe('buildCookieOptions', () => {
  test('returns httpOnly lax cookie with path "/" and dev secure=false', () => {
    process.env.NODE_ENV = 'development';
    process.env.TOKEN_EXPIRES_IN = '8h';
    const options = buildCookieOptions();
    expect(options).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: false
    });
    expect(options.maxAge).toBe(8 * 60 * 60 * 1000);
  });

  test('sets secure=true in production', () => {
    process.env.NODE_ENV = 'production';
    expect(buildCookieOptions().secure).toBe(true);
  });

  test('leaves maxAge undefined for unsupported expiry formats', () => {
    process.env.TOKEN_EXPIRES_IN = 'P1D';
    expect(buildCookieOptions().maxAge).toBeUndefined();
  });
});