const User = require('../models/User');

const RESPONSIBLE_PROJECTION = '_id email firstName lastName jobTitle';

const idOf = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object' && value._id !== undefined) return String(value._id);
  return String(value);
};

const toPlain = (document) => (document && typeof document.toObject === 'function'
  ? document.toObject()
  : { ...document });

const projectUser = (user) => {
  if (!user) return null;
  const projected = { _id: idOf(user._id), email: user.email };
  for (const field of ['firstName', 'lastName', 'jobTitle']) {
    if (user[field] !== undefined) projected[field] = user[field];
  }
  return projected;
};

const currentResponsibleId = (document, plain) => idOf(
  document.responsible !== undefined ? document.responsible : plain.responsible
);

async function serializeDocument(document, extra) {
  const plain = toPlain(document);
  const responsibleId = currentResponsibleId(document, plain);

  const responsible = responsibleId
    ? projectUser(await User.findById(responsibleId).select(RESPONSIBLE_PROJECTION))
    : null;

  return { ...plain, ...extra, responsible };
}

async function serializeDocuments(documents) {
  const plains = documents.map(toPlain);
  const ids = [...new Set(plains.map((plain, index) => currentResponsibleId(documents[index], plain)).filter(Boolean))];

  const byId = new Map();
  if (ids.length > 0) {
    const users = await User.find({ _id: { $in: ids } }).select(RESPONSIBLE_PROJECTION);
    for (const user of users || []) {
      byId.set(idOf(user._id), projectUser(user));
    }
  }

  return plains.map((plain, index) => {
    const responsibleId = currentResponsibleId(documents[index], plain);
    return { ...plain, responsible: responsibleId ? byId.get(responsibleId) || null : null };
  });
}

module.exports = { serializeDocument, serializeDocuments, RESPONSIBLE_PROJECTION };
