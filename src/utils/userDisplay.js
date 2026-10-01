const Joi = require('joi');

// D-110: los tres campos de perfil viven en un unico lugar para que el schema, la
// normalizacion y la derivacion de fullName no puedan divergir entre si.
const PROFILE_FIELDS = ['firstName', 'lastName', 'jobTitle'];

const PROFILE_LIMITS = {
  firstName: 60,
  lastName: 60,
  jobTitle: 120
};

function profileEntrySchema(limit) {
  return Joi.string().trim().max(limit).allow('', null);
}

function profileJoiSchema() {
  return Joi.object({
    firstName: profileEntrySchema(PROFILE_LIMITS.firstName),
    lastName: profileEntrySchema(PROFILE_LIMITS.lastName),
    jobTitle: profileEntrySchema(PROFILE_LIMITS.jobTitle)
  });
}

// Un valor ausente y uno en blanco significan lo mismo para el usuario: no hay dato.
function normalizeProfileValue(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

// Nombre a partir del perfil, con el correo como ultimo recurso para no perder la
// identidad del usuario en las listas.
function fullNameOf(user) {
  if (!user) return null;
  const first = normalizeProfileValue(user.firstName);
  const last = normalizeProfileValue(user.lastName);
  return [first, last].filter(Boolean).join(' ') || user.email || null;
}

module.exports = {
  PROFILE_FIELDS,
  PROFILE_LIMITS,
  normalizeProfileValue,
  fullNameOf,
  profileJoiSchema
};