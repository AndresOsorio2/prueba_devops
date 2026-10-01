const config = require('../config');

const DEFAULT_ALLOWED_DOMAINS = config.DEFAULT_ALLOWED_EMAIL_DOMAINS;

function parseAllowedEmailDomains(raw) {
  if (raw === undefined || raw === null) {
    return [...DEFAULT_ALLOWED_DOMAINS];
  }
  return String(raw)
    .split(',')
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);
}

// El segundo parametro sigue siendo el seam de test: si se pasa, manda el explicito;
// si no, se resuelve desde config en el momento de la llamada (D-101).
function isEmailAllowed(email, raw) {
  const domain = String(email).split('@').pop().toLowerCase();
  if (raw !== undefined) return parseAllowedEmailDomains(raw).includes(domain);
  return config.allowedEmailDomains.includes(domain);
}

module.exports = { DEFAULT_ALLOWED_DOMAINS, parseAllowedEmailDomains, isEmailAllowed };