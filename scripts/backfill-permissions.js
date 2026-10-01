require('dotenv').config();
// D-002: dotenv antes de config. El script usa config.mongoUri (que lanza nombrando la
// variable) pero no llama validate(), porque solo necesita Mongo.
const config = require('../src/config');
const mongoose = require('mongoose');
const User = require('../src/models/User');

const LEGACY_PERMISSIONS = [
  'project:read', 'project:write',
  'document:read', 'document:write',
  'rule:read', 'rule:write',
  'template:read', 'template:write',
  'users:write'
];

const NEW_PERMISSIONS = [
  'project:members',
  'evidence:read', 'evidence:write',
  'document:responsible'
];

function missingNewPermissions(current) {
  if (!Array.isArray(current)) {
    return [];
  }
  const hasFullLegacyCatalog = LEGACY_PERMISSIONS.every((permission) => current.includes(permission));
  if (!hasFullLegacyCatalog) {
    return [];
  }
  return NEW_PERMISSIONS.filter((permission) => !current.includes(permission));
}

function mergePermissions(current, additions) {
  return [...new Set([...(Array.isArray(current) ? current : []), ...additions])];
}

function parseArgs(argv) {
  const hasApply = argv.includes('--apply');
  const hasDryRun = argv.includes('--dry-run');
  if (hasApply && hasDryRun) {
    throw new Error('Usa --apply o --dry-run, no ambos.');
  }
  return { apply: hasApply, dryRun: !hasApply };
}

async function backfill({ apply = false, log = console.log } = {}) {
  const users = await User.find({}).select('email permissions').lean();
  const report = { scanned: users.length, updated: 0, unchanged: 0, skipped: 0, details: [] };

  for (const user of users) {
    const additions = missingNewPermissions(user.permissions);

    if (additions.length === 0) {
      const alreadyComplete = LEGACY_PERMISSIONS.every((permission) =>
        (user.permissions || []).includes(permission)
      );
      if (alreadyComplete) {
        report.unchanged += 1;
        log(`  = ${user.email}: ya tiene los ${LEGACY_PERMISSIONS.length + NEW_PERMISSIONS.length} permisos`);
      } else {
        report.skipped += 1;
        log(`  - ${user.email}: cat\u00e1logo incompleto (${(user.permissions || []).length} permisos), se deja intacto`);
      }
      continue;
    }

    report.updated += 1;
    report.details.push({ email: user.email, added: additions });

    if (apply) {
      await User.updateOne({ _id: user._id }, { $set: { permissions: mergePermissions(user.permissions, additions) } });
      log(`  + ${user.email}: +${additions.join(', ')}`);
    } else {
      log(`  + ${user.email}: +${additions.join(', ')} (simulado)`);
    }
  }

  return report;
}

async function run(argv = process.argv.slice(2)) {
  const { apply, dryRun } = parseArgs(argv);
  const mode = apply ? 'APLICANDO' : 'SIMULADO (sin --apply no se escribe nada)';

await mongoose.connect(config.mongoUri);
  try {
    console.log(`Backfill de permisos 9 → 13 [${mode}]`);
    console.log(`Base: ${config.mongoUri.replace(/\/\/([^@]+)@/, '//***@')}`);
    const report = await backfill({ apply });
    console.log('');
    console.log(`Leidos: ${report.scanned} | a ampliar: ${report.updated} | sin cambios: ${report.unchanged} | omitidos: ${report.skipped}`);
    if (dryRun && report.updated > 0) {
      console.log('');
      console.log('Sin cambios. Reejecuta con --apply para escribir.');
    }
    return report;
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  run().catch((err) => {
    console.error('[backfill] Error:', err.message);
    process.exit(1);
  });
}

module.exports = { LEGACY_PERMISSIONS, NEW_PERMISSIONS, missingNewPermissions, mergePermissions, parseArgs, backfill, run };
