const PERMISSIONS = [
  'project:read', 'project:write', 'project:members',
  'document:read', 'document:write', 'document:responsible',
  'rule:read', 'rule:write',
  'evidence:read', 'evidence:write',
  'template:read', 'template:write',
  'users:write'
];

const ALL_PERMISSIONS = [...PERMISSIONS];

module.exports = { PERMISSIONS, ALL_PERMISSIONS };
