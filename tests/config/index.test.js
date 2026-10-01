const fs = require('fs');
const path = require('path');

const SRC_DIR = path.resolve(__dirname, '../../src');
const SCRIPTS_DIR = path.resolve(__dirname, '../../scripts');
const CONFIG_DIR = path.join(SRC_DIR, 'config');

const CONFIG_VARS = [
  'PORT',
  'MONGODB_URI',
  'JWT_SECRET',
  'TOKEN_EXPIRES_IN',
  'CORS_ORIGIN',
  'NODE_ENV',
  'UPLOAD_DIR',
  'SEQ_SERVER_URL',
  'SEQ_API_KEY',
  'ALLOWED_EMAIL_DOMAINS',
  'AZURE_OPENAI_ENDPOINT',
  'AZURE_OPENAI_DEPLOYMENT',
  'AZURE_OPENAI_API_VERSION',
  'AZURE_OPENAI_API_KEY',
  'AZURE_OPENAI_TIMEOUT_MS',
];

// Las tres que hacen fallar el arranque (AC3).
const REQUIRED_VARS = ['JWT_SECRET', 'MONGODB_URI', 'CORS_ORIGIN'];

const ORIGINAL_ENV = process.env;

describe('config (feature 102)', () => {
  let env;
  let config;

  beforeEach(() => {
    jest.resetModules();
    // Cada test parte de un env conocido: nada se hereda del shell del desarrollador.
    process.env = { ...ORIGINAL_ENV };
    CONFIG_VARS.forEach((name) => {
      delete process.env[name];
    });
    env = require('../../src/config/env');
    config = require('../../src/config/index');
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  describe('env.required', () => {
    it('returns the value when it is set', () => {
      process.env.JWT_SECRET = 'a-secret';
      expect(env.required('JWT_SECRET')).toBe('a-secret');
    });

    it('throws naming the variable when it is missing', () => {
      expect(() => env.required('JWT_SECRET')).toThrow(/JWT_SECRET/);
    });

    it('throws naming the variable when it is an empty string', () => {
      process.env.JWT_SECRET = '';
      expect(() => env.required('JWT_SECRET')).toThrow(/JWT_SECRET/);
    });

    it('does not leak the value it was validating', () => {
      expect(() => env.required('MONGODB_URI')).not.toThrow(/mongodb:\/\//);
    });
  });

  describe('env.optional', () => {
    it('returns the fallback when the variable is missing', () => {
      expect(env.optional('SEQ_API_KEY', '')).toBe('');
    });

    it('returns the fallback when the variable is an empty string', () => {
      process.env.SEQ_API_KEY = '';
      expect(env.optional('SEQ_API_KEY', 'fallback')).toBe('fallback');
    });

    it('returns the fallback when it is explicitly undefined', () => {
      expect(env.optional('NOT_SET', 42)).toBe(42);
    });

    it('keeps a zero-looking value instead of treating it as absent', () => {
      process.env.SOME_COUNT = '0';
      expect(env.optional('SOME_COUNT', '99')).toBe('0');
    });
  });

  describe('env.integer', () => {
    it('parses a valid number', () => {
      process.env.A_TIMEOUT = '5000';
      expect(env.integer('A_TIMEOUT', 240000)).toBe(5000);
    });

    it('falls back when the variable is missing', () => {
      expect(env.integer('A_TIMEOUT', 240000)).toBe(240000);
    });

    it('falls back when the value is not numeric', () => {
      process.env.A_TIMEOUT = 'not-a-number';
      expect(env.integer('A_TIMEOUT', 240000)).toBe(240000);
    });

    it.each([
      ['zero', '0'],
      ['negative', '-5'],
      ['an empty string', ''],
    ])('falls back when the value is %s', (_label, raw) => {
      process.env.A_TIMEOUT = raw;
      expect(env.integer('A_TIMEOUT', 240000)).toBe(240000);
    });
  });

  describe('env.csv', () => {
    it('falls back when the variable is missing', () => {
      expect(env.csv('ALLOWED_EMAIL_DOMAINS', ['softwareone.com'])).toEqual(['softwareone.com']);
    });

    it('splits, trims and lowercases the entries', () => {
      process.env.ALLOWED_EMAIL_DOMAINS = ' SoftwareOne.com , foo.com ';
      expect(env.csv('ALLOWED_EMAIL_DOMAINS', [])).toEqual(['softwareone.com', 'foo.com']);
    });

    it('drops empty entries', () => {
      process.env.ALLOWED_EMAIL_DOMAINS = 'a.com,,  ,b.com';
      expect(env.csv('ALLOWED_EMAIL_DOMAINS', [])).toEqual(['a.com', 'b.com']);
    });

    it('falls back when every entry is empty', () => {
      process.env.ALLOWED_EMAIL_DOMAINS = ' , ';
      expect(env.csv('ALLOWED_EMAIL_DOMAINS', ['softwareone.com'])).toEqual(['softwareone.com']);
    });
  });

  describe('config getters', () => {
    it('reads PORT when it is set', () => {
      process.env.PORT = '3001';
      expect(config.port).toBe(3001);
    });

    it('defaults PORT to 3000 (AC4: the default does not move)', () => {
      expect(config.port).toBe(3000);
    });

    it('falls back to 3000 when PORT is not a number', () => {
      process.env.PORT = 'abc';
      expect(config.port).toBe(3000);
    });

    it('exposes MONGODB_URI, JWT_SECRET and CORS_ORIGIN', () => {
      process.env.MONGODB_URI = 'mongodb://localhost:27017/dm';
      process.env.JWT_SECRET = 'a-secret';
      process.env.CORS_ORIGIN = 'http://localhost:8083';

      expect(config.mongoUri).toBe('mongodb://localhost:27017/dm');
      expect(config.jwtSecret).toBe('a-secret');
      expect(config.corsOrigin).toBe('http://localhost:8083');
    });

    it.each(REQUIRED_VARS)('throws naming %s when it is missing', (name) => {
      const property = { JWT_SECRET: 'jwtSecret', MONGODB_URI: 'mongoUri', CORS_ORIGIN: 'corsOrigin' }[name];
      expect(() => config[property]).toThrow(new RegExp(name));
    });

    it('defaults TOKEN_EXPIRES_IN to 8h (AC7)', () => {
      expect(config.tokenExpiresIn).toBe('8h');
    });

    it('reads TOKEN_EXPIRES_IN when it is set', () => {
      process.env.TOKEN_EXPIRES_IN = '1h';
      expect(config.tokenExpiresIn).toBe('1h');
    });

    it('leaves NODE_ENV undefined when it is not set', () => {
      expect(config.nodeEnv).toBeUndefined();
    });

    it('reads NODE_ENV when it is set', () => {
      process.env.NODE_ENV = 'production';
      expect(config.nodeEnv).toBe('production');
    });

    it('defaults UPLOAD_DIR to ./uploads resolved against cwd', () => {
      expect(config.uploadDir).toBe(path.resolve(process.cwd(), './uploads'));
    });

    it('reads UPLOAD_DIR when it is set', () => {
      process.env.UPLOAD_DIR = '/tmp/uploads';
      expect(config.uploadDir).toBe(path.resolve('/tmp/uploads'));
    });

    it('defaults SEQ_SERVER_URL to null so the logger stays on console', () => {
      expect(config.seq.serverUrl).toBeNull();
    });

    it('defaults SEQ_API_KEY to an empty string', () => {
      expect(config.seq.apiKey).toBe('');
    });

    it('reads the SEQ pair when it is set', () => {
      process.env.SEQ_SERVER_URL = 'http://localhost:5341';
      process.env.SEQ_API_KEY = 'seq-key';

      expect(config.seq.serverUrl).toBe('http://localhost:5341');
      expect(config.seq.apiKey).toBe('seq-key');
    });

    it('defaults ALLOWED_EMAIL_DOMAINS to softwareone.com', () => {
      expect(config.allowedEmailDomains).toEqual(['softwareone.com']);
    });

    it('reads ALLOWED_EMAIL_DOMAINS as a csv when it is set', () => {
      process.env.ALLOWED_EMAIL_DOMAINS = 'rimac.com, SoftwareOne.com';
      expect(config.allowedEmailDomains).toEqual(['rimac.com', 'softwareone.com']);
    });
  });

  describe('config.resolveMaxAgeMs', () => {
    it.each([
      ['30s', 30 * 1000],
      ['15m', 15 * 60 * 1000],
      ['8h', 8 * 60 * 60 * 1000],
      ['7d', 7 * 24 * 60 * 60 * 1000],
    ])('converts %s to milliseconds', (expiresIn, expected) => {
      expect(config.resolveMaxAgeMs(expiresIn)).toBe(expected);
    });

    it.each([
      ['a jsonwebtoken style value', 'P1D'],
      ['garbage', 'forever'],
      ['a missing unit', '12'],
      ['nothing', undefined],
    ])('returns undefined for %s', (_label, expiresIn) => {
      expect(config.resolveMaxAgeMs(expiresIn)).toBeUndefined();
    });
  });

  describe('config.validate', () => {
    beforeEach(() => {
      process.env.JWT_SECRET = 'a-secret';
      process.env.MONGODB_URI = 'mongodb://localhost:27017/dm';
      process.env.CORS_ORIGIN = 'http://localhost:8083';
    });

    it('passes when the three required variables are present', () => {
      expect(() => config.validate()).not.toThrow();
    });

    it('passes when no optional variable is set at all (AC3)', () => {
      expect(() => config.validate()).not.toThrow();
    });

    it.each(REQUIRED_VARS)('throws naming %s when it alone is missing', (name) => {
      delete process.env[name];
      expect(() => config.validate()).toThrow(new RegExp(name));
    });

    it('lists every missing variable in a single message (AC2)', () => {
      // eslint-disable-next-line no-unused-vars
      const [jwt, mongo, cors] = REQUIRED_VARS;
      delete process.env.JWT_SECRET;
      delete process.env.MONGODB_URI;
      delete process.env.CORS_ORIGIN;

      expect(() => config.validate()).toThrow(/JWT_SECRET[\s\S]*MONGODB_URI[\s\S]*CORS_ORIGIN/);
    });

    it('does not list the variables that are present', () => {
      delete process.env.MONGODB_URI;
      expect(() => config.validate()).toThrow(/^[\s\S]*MONGODB_URI[\s\S]*$/);
      expect(() => config.validate()).not.toThrow(/MONGODB_URI[\s\S]*JWT_SECRET/);
    });

    it('does not mention the optional Azure OpenAI variables (AC6)', () => {
      expect(() => config.validate()).not.toThrow(/AZURE_OPENAI/);
    });

    it('does not mention SEQ_SERVER_URL or UPLOAD_DIR', () => {
      expect(() => config.validate()).not.toThrow(/SEQ_SERVER_URL|UPLOAD_DIR/);
    });
  });

  describe('config.azureOpenAI', () => {
    const setComplete = () => {
      process.env.AZURE_OPENAI_ENDPOINT = 'https://example.openai.azure.com/';
      process.env.AZURE_OPENAI_DEPLOYMENT = 'gpt-4.1';
      process.env.AZURE_OPENAI_API_VERSION = '2024-10-21';
      process.env.AZURE_OPENAI_API_KEY = 'test-key';
    };

    it('is not configured when no Azure OpenAI variable is set', () => {
      expect(config.azureOpenAI.isConfigured).toBe(false);
    });

    it('is configured once the four credentials are set', () => {
      setComplete();
      expect(config.azureOpenAI.isConfigured).toBe(true);
    });

    it.each([
      ['AZURE_OPENAI_ENDPOINT'],
      ['AZURE_OPENAI_DEPLOYMENT'],
      ['AZURE_OPENAI_API_KEY'],
    ])('is not configured when only %s is missing', (missing) => {
      setComplete();
      delete process.env[missing];
      expect(config.azureOpenAI.isConfigured).toBe(false);
    });

    it('require() throws AI_CONFIG_MISSING when credentials are absent (AC6)', () => {
      expect(() => config.azureOpenAI.require()).toThrow(
        expect.objectContaining({ code: 'AI_CONFIG_MISSING' })
      );
    });

    it('require() names the variables it needs', () => {
      expect(() => config.azureOpenAI.require()).toThrow(/AZURE_OPENAI_API_KEY[\s\S]*AZURE_OPENAI_ENDPOINT[\s\S]*AZURE_OPENAI_DEPLOYMENT/);
    });

    it('require() builds the endpoint url without trailing slashes', () => {
      setComplete();
      const { apiUrl } = config.azureOpenAI.require();

      expect(apiUrl).toBe(
        'https://example.openai.azure.com/openai/deployments/gpt-4.1/chat/completions?api-version=2024-10-21'
      );
    });

    it('defaults the api version to 2024-10-21', () => {
      expect(config.azureOpenAI.apiVersion).toBe('2024-10-21');
    });

    it('reads the api version when it is set', () => {
      process.env.AZURE_OPENAI_API_VERSION = '2025-01-01';
      expect(config.azureOpenAI.apiVersion).toBe('2025-01-01');
    });

    it('defaults the timeout to 240000 ms', () => {
      expect(config.azureOpenAI.timeoutMs).toBe(240000);
    });

    it('reads the timeout when it is set', () => {
      process.env.AZURE_OPENAI_TIMEOUT_MS = '300000';
      expect(config.azureOpenAI.timeoutMs).toBe(300000);
    });
  });

  describe('el servidor no carga dotenv (D-002)', () => {
    it('never calls dotenv.config from the config module', () => {
      jest.resetModules();
      jest.doMock('dotenv', () => ({ config: jest.fn() }));

      require('../../src/config/index');

      // eslint-disable-next-line global-require
      const dotenv = require('dotenv');
      expect(dotenv.config).not.toHaveBeenCalled();
    });
  });

  describe('process.env solo vive en src/config (AC5)', () => {
    const walk = (dir) =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return walk(full);
        return entry.name.endsWith('.js') ? [full] : [];
      });

    const offenders = () =>
      [...walk(SRC_DIR), ...walk(SCRIPTS_DIR)]
        .filter((file) => !file.startsWith(CONFIG_DIR))
        .filter((file) => fs.readFileSync(file, 'utf8').includes('process.env'));

    it('finds no process.env outside src/config', () => {
      expect(offenders()).toEqual([]);
    });

    it('sanity: src/config does read process.env, so the scan is not vacuous', () => {
      const configFiles = walk(CONFIG_DIR);
      expect(configFiles.length).toBeGreaterThan(0);
      expect(configFiles.some((file) => fs.readFileSync(file, 'utf8').includes('process.env'))).toBe(
        true
      );
    });
  });
});