const { RULE_TYPES } = require('../../src/models/ruleTypes');
const Rule = require('../../src/models/Rule');
const Template = require('../../src/models/Template');

describe('ruleTypes shared constant', () => {
  test('exports the exact 9 rule types', () => {
    expect(RULE_TYPES).toEqual(['text', 'number', 'url', 'date', 'select', 'textarea', 'file', 'multi-file', 'combined']);
  });

  test('Rule schema type enum references the shared constant', () => {
    expect(Rule.schema.path('type').enumValues).toEqual(RULE_TYPES);
  });

  test('Template item schema type enum references the shared constant', () => {
    const itemSchema = Template.schema.path('items').schema;
    expect(itemSchema.path('type').enumValues).toEqual(RULE_TYPES);
  });
});