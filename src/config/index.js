// D-101: cada getter lee process.env en el momento del acceso, no al cargar el modulo.
// Los tests del backend cambian el entorno en caliente (borran JWT_SECRET, reasignan
// process.env entero, ajustan ALLOWED_EMAIL_DOMAINS por test), asi que un snapshot aqui
// devolveria valores congelados y romperia tres suites de regresion.
//
// D-002: este modulo no carga dotenv; los entrypoints lo hacen antes de importarlo.

const path = require('path');
const env = require('./env');

const DEFAULT_PORT = 3000;
const DEFAULT_TOKEN_EXPIRES_IN = '8h';
const DEFAULT_UPLOAD_DIR = './uploads';
const DEFAULT_ALLOWED_EMAIL_DOMAINS = ['softwareone.com'];
const DEFAULT_SEQ_API_KEY = '';
const DEFAULT_AZURE_API_VERSION = '2024-10-21';
const DEFAULT_AZURE_TIMEOUT_MS = 240000;

const MAX_AGE_UNITS = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };

// Unicas tres que impiden arrancar (AC3). El resto tiene default explicito.
const REQUIRED_VARS = ['JWT_SECRET', 'MONGODB_URI', 'CORS_ORIGIN'];

const AZURE_REQUIRED_VARS = ['AZURE_OPENAI_API_KEY', 'AZURE_OPENAI_ENDPOINT', 'AZURE_OPENAI_DEPLOYMENT'];

function missingRequired(names) {
  return names.filter((name) => !process.env[name]);
}

/**
 * Convierte '8h' en milisegundos. Devuelve undefined para lo que no reconoce, que es lo
 * que hoy devuelve tokenService: un valor estilo jsonwebtoken ('P1D') no fija maxAge.
 */
function resolveMaxAgeMs(expiresIn) {
  const match = String(expiresIn).match(/^(\d+)(s|m|h|d)$/);
  if (!match) return undefined;
  return Number(match[1]) * MAX_AGE_UNITS[match[2]];
}

const azureOpenAI = {
  // D-104: Azure OpenAI no se exige al arrancar, porque docker-compose no pasa estas
  // variables. Sigue fallando en el punto de uso, con el mismo codigo de siempre.
  get isConfigured() {
    return missingRequired(AZURE_REQUIRED_VARS).length === 0;
  },

  require() {
    const missing = missingRequired(AZURE_REQUIRED_VARS);
    if (missing.length > 0) {
      const error = new Error(
        `Faltan credenciales de Azure OpenAI (${missing.join('/')}) en el entorno del backend`
      );
      error.code = 'AI_CONFIG_MISSING';
      throw error;
    }
    const endpoint = String(process.env.AZURE_OPENAI_ENDPOINT).replace(/\/+$/, '');
    const deployment = process.env.AZURE_OPENAI_DEPLOYMENT;
    return {
      apiKey: process.env.AZURE_OPENAI_API_KEY,
      apiUrl: `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${env.optional(
        'AZURE_OPENAI_API_VERSION',
        DEFAULT_AZURE_API_VERSION
      )}`,
    };
  },

  get apiVersion() {
    return env.optional('AZURE_OPENAI_API_VERSION', DEFAULT_AZURE_API_VERSION);
  },

  get timeoutMs() {
    return env.integer('AZURE_OPENAI_TIMEOUT_MS', DEFAULT_AZURE_TIMEOUT_MS);
  },
};

module.exports = {
  env,
  DEFAULT_ALLOWED_EMAIL_DOMAINS,

  get port() {
    return env.integer('PORT', DEFAULT_PORT);
  },
  get mongoUri() {
    return env.required('MONGODB_URI');
  },
  get jwtSecret() {
    return env.required('JWT_SECRET');
  },
  get corsOrigin() {
    return env.required('CORS_ORIGIN');
  },
  get nodeEnv() {
    return env.optional('NODE_ENV', undefined);
  },
  get tokenExpiresIn() {
    return env.optional('TOKEN_EXPIRES_IN', DEFAULT_TOKEN_EXPIRES_IN);
  },
  get uploadDir() {
    return path.resolve(process.cwd(), env.optional('UPLOAD_DIR', DEFAULT_UPLOAD_DIR));
  },
  get seq() {
    return {
      serverUrl: env.optional('SEQ_SERVER_URL', null),
      apiKey: env.optional('SEQ_API_KEY', DEFAULT_SEQ_API_KEY),
    };
  },
  get allowedEmailDomains() {
    return env.csv('ALLOWED_EMAIL_DOMAINS', DEFAULT_ALLOWED_EMAIL_DOMAINS);
  },

  resolveMaxAgeMs,
  azureOpenAI,

  // D-103: la invoca solo src/index.js. seed.js y el script de permisos acceden a
  // config.mongoUri, que lanza nombrando la variable, pero solo cuando se ejecutan.
  validate() {
    const missing = missingRequired(REQUIRED_VARS);
    if (missing.length > 0) {
      throw new Error(
        `Faltan variables de entorno requeridas: ${missing.join(', ')}. Definelas en el entorno (ver backend/.env.example) antes de arrancar.`
      );
    }
  },
};