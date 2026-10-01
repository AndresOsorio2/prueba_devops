const mongoose = require('mongoose');
const { PERMISSIONS } = require('./permissions');
const { PROFILE_LIMITS, fullNameOf } = require('../utils/userDisplay');

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  passwordHash: {
    type: String,
    required: true
  },
  firstName: {
    type: String,
    trim: true,
    maxlength: PROFILE_LIMITS.firstName,
    default: null
  },
  lastName: {
    type: String,
    trim: true,
    maxlength: PROFILE_LIMITS.lastName,
    default: null
  },
  jobTitle: {
    type: String,
    trim: true,
    maxlength: PROFILE_LIMITS.jobTitle,
    default: null
  },
  active: {
    type: Boolean,
    default: true
  },
  mustChangePassword: {
    type: Boolean,
    default: true
  },
  permissions: {
    type: [String],
    default: [],
    validate: {
      validator: (values) => values.every((permission) => PERMISSIONS.includes(permission)),
      message: (props) => `Invalid permission(s): ${props.value.join(', ')}`
    }
  },
  provider: {
    type: String,
    enum: ['local', 'microsoft'],
    default: 'local'
  },
  externalId: {
    type: String,
    default: null
  }
}, {
  timestamps: true
});

// fullName es derivado: se agrega solo en la copia serializada, nunca al documento,
// para que no se pueda escribir desde la API.
function sanitize(doc, ret) {
  delete ret.passwordHash;
  ret.fullName = fullNameOf(ret);
  return ret;
}

userSchema.set('toJSON', { transform: sanitize });
userSchema.set('toObject', { transform: sanitize });

module.exports = mongoose.model('User', userSchema);