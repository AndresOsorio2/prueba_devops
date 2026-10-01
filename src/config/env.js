// D-002: este modulo NO carga dotenv. Los entrypoints (`src/index.js`, `src/seed.js` y
// `scripts/backfill-permissions.js`) siguen llamandolo en su primera linea, antes de
// importar cualquier cosa. Si se moviera aqui, todo test que importara config pasaria
// a heredar el `.env` del desarrollador —con la API key real dentro—.

/**
 * Lee una variable obligatoria y lanza si falta. El mensaje nombra la variable para que
 * el arranque falle de forma accionable en vez de reventar en el primer uso.
 */
function required(name) {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`${name} is not configured. Set ${name} in the environment before starting the backend.`);
  }
  return value;
}

/**
 * Lee una variable con default. Ausente y cadena vacia significan lo mismo: no hay dato.
 */
function optional(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  return value;
}

/**
 * Lee un entero con default. Cae al default si no es un numero o si no es positivo.
 */
function integer(name, fallback) {
  const raw = optional(name, undefined);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return value;
}

/**
 * Lee una lista separada por comas, recortada y en minusculas. Si no queda ninguna
 * entrada utilizable devuelve el default.
 */
function csv(name, fallback) {
  const raw = optional(name, undefined);
  if (raw === undefined) return fallback;
  const entries = String(raw)
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return entries.length > 0 ? entries : fallback;
}

module.exports = { required, optional, integer, csv };