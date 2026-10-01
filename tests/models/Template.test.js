const Template = require('../../src/models/Template');
const { RULE_TYPES } = require('../../src/models/ruleTypes');

describe('Template schema', () => {
  test('requires a unique name', () => {
    expect(Template.schema.path('name').isRequired).toBe(true);
    expect(Template.schema.path('name').options.unique).toBe(true);
  });

  test('has description default empty string', () => {
    expect(Template.schema.path('description').options.default).toBe('');
  });

  test('items default to empty array', () => {
    expect(Template.schema.path('items').options.default).toEqual([]);
    expect(Template.schema.path('items').instance).toBe('Array');
  });

  test('items embed the recursive templateItemSchema', () => {
    const itemSchema = Template.schema.path('items').schema;
    expect(itemSchema).toBe(Template.templateItemSchema);
    expect(itemSchema.path('children').schema).toBe(Template.templateItemSchema);
  });

  test('item exposes the configuration fields', () => {
    const itemSchema = Template.templateItemSchema;
    expect(itemSchema.path('name').isRequired).toBe(true);
    expect(itemSchema.path('description').options.default).toBe('');
    expect(itemSchema.path('type').isRequired).toBe(true);
    expect(itemSchema.path('type').enumValues).toEqual(RULE_TYPES);
    expect(itemSchema.path('required').options.default).toBe(true);
    expect(itemSchema.path('order').options.default).toBe(0);
    expect(itemSchema.path('selectOptions').instance).toBe('Array');
    expect(itemSchema.path('markdownContent').options.default).toBe('');
    expect(itemSchema.path('notify').options.default).toBe(true);
  });

  test('item excludes instance-specific fields', () => {
    const itemSchema = Template.templateItemSchema;
    for (const forbidden of ['projectId', 'deadline', 'status', 'evidences', 'documentId', 'parentId']) {
      expect(itemSchema.path(forbidden)).toBeUndefined();
    }
    expect(Template.schema.path('projectId')).toBeUndefined();
    expect(Template.schema.path('deadline')).toBeUndefined();
    expect(Template.schema.path('status')).toBeUndefined();
  });
});