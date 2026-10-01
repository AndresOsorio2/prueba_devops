const Template = require('../models/Template');
const Rule = require('../models/Rule');

class TemplateNameExistsError extends Error {
  constructor(name) {
    super(`Ya existe una plantilla llamada "${name}"`);
    this.name = 'TemplateNameExistsError';
    this.code = 'TEMPLATE_NAME_EXISTS';
  }
}

const buildItemsFromRules = async (documentId, parentId = null) => {
  const rules = await Rule.find({ documentId, parentId }).sort({ order: 1 });
  return Promise.all(rules.map(async (rule) => ({
    name: rule.name,
    description: rule.description || '',
    type: rule.type,
    required: rule.required,
    order: rule.order,
    selectOptions: rule.selectOptions || [],
    markdownContent: rule.markdownContent || '',
    notify: rule.notify,
    children: await buildItemsFromRules(documentId, rule._id)
  })));
};

const saveTemplateFromSnapshot = async ({ name, description, items }) => {
  const existing = await Template.findOne({ name });
  if (existing) {
    throw new TemplateNameExistsError(name);
  }
  const template = new Template({ name, description: description || '', items });
  try {
    await template.save();
  } catch (error) {
    if (error.code === 11000) {
      throw new TemplateNameExistsError(name);
    }
    throw error;
  }
  return template;
};

const materializeTemplateItems = async ({ documentId, parentId = null, items = [] }) => {
  const rules = [];
  for (const item of items) {
    const rule = await new Rule({
      documentId,
      parentId,
      name: item.name,
      description: item.description || '',
      type: item.type,
      required: item.required,
      order: item.order,
      selectOptions: item.selectOptions || [],
      markdownContent: item.markdownContent || '',
      notify: item.notify
    }).save();
    rules.push(rule);
    if (item.children && item.children.length > 0) {
      const descendants = await materializeTemplateItems({ documentId, parentId: rule._id, items: item.children });
      rules.push(...descendants);
    }
  }
  return rules;
};

module.exports = { buildItemsFromRules, saveTemplateFromSnapshot, materializeTemplateItems, TemplateNameExistsError };