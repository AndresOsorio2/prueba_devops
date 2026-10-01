require('dotenv').config();
// D-002: dotenv antes de config. D-103: seed NO llama validate(); usa config.mongoUri,
// que lanza nombrando la variable solo si de verdad falta.
const config = require('./config');
const mongoose = require('mongoose');
const User = require('./models/User');
const { ALL_PERMISSIONS } = require('./models/permissions');
const { hashPassword, generateProvisionalPassword, BCRYPT_ROUNDS } = require('./services/passwordService');

const SEED_ADMIN_EMAIL = 'admin@softwareone.com';

async function seedAdmin() {
  const existing = await User.findOne({ email: SEED_ADMIN_EMAIL });
  if (existing) {
    return { status: 'exists', email: SEED_ADMIN_EMAIL };
  }

  const provisional = generateProvisionalPassword();
  const passwordHash = await hashPassword(provisional);

  const admin = await User.create({
    email: SEED_ADMIN_EMAIL,
    passwordHash,
    active: true,
    mustChangePassword: true,
    permissions: [...ALL_PERMISSIONS],
    provider: 'local'
  });

  return { status: 'created', email: SEED_ADMIN_EMAIL, provisional, userId: admin._id };
}

async function run() {
  await mongoose.connect(config.mongoUri);
  const result = await seedAdmin();
  if (result.status === 'created') {
    console.log(`[seed] Admin creado: ${result.email}`);
    console.log(`[seed] Contraseña provisional (entrégala al admin y no la compartas): ${result.provisional}`);
  } else {
    console.log(`[seed] Admin ya existe (intacto): ${result.email}`);
  }
  await mongoose.disconnect();
}

if (require.main === module) {
  run().catch((err) => {
    console.error('[seed] Error:', err.message);
    process.exit(1);
  });
}

module.exports = { seedAdmin, run, SEED_ADMIN_EMAIL, BCRYPT_ROUNDS };