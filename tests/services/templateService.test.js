jest.mock('../../src/models/Template', () => require('../mocks/mongooseModel')());
jest.mock('../../src/models/Rule', () => require('../mocks/mongooseModel')());

const Template = require('../../src/models/Template');
const Rule = require('../../src/models/Rule');
const { buildItemsFromRules, saveTemplateFromSnapshot, materializeTemplateItems, TemplateNameExistsError } = require('../../src/services/templateService');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('templateService - buildItemsFromRules', () => {
  test('maps rules to template items keeping only template fields (whitelist)', async () => {
    const roots = [{
      _id: 'r1',
      documentId: 'd1',
      parentId: null,
      name: 'Objetivo',
      description: 'Alcance',
      type: 'textarea',
      required: true,
      deadline: new Date('2026-10-01'),
      status: 'in_progress',
      order: 0,
      selectOptions: ['a', 'b'],
      markdownContent: '# Contenido',
      notify: false,
      createdAt: new Date(),
      updatedAt: new Date()
    }];
    Rule.find.mockImplementation((query) => ({
      sort: jest.fn().mockResolvedValue(query.parentId === null ? roots : [])
    }));

    const items = await buildItemsFromRules('d1');

    expect(Rule.find).toHaveBeenCalledWith({ documentId: 'd1', parentId: null });
    expect(items).toEqual([{
      name: 'Objetivo',
      description: 'Alcance',
      type: 'textarea',
      required: true,
      order: 0,
      selectOptions: ['a', 'b'],
      markdownContent: '# Contenido',
      notify: false,
      children: []
    }]);
    expect(items[0]).not.toHaveProperty('_id');
    expect(items[0]).not.toHaveProperty('documentId');
    expect(items[0]).not.toHaveProperty('parentId');
    expect(items[0]).not.toHaveProperty('deadline');
    expect(items[0]).not.toHaveProperty('status');
    expect(items[0]).not.toHaveProperty('createdAt');
    expect(items[0]).not.toHaveProperty('updatedAt');
  });

  test('recursively builds nested children ordered by order asc', async () => {
    const roots = [{ _id: 'r1', parentId: null, name: 'Root', description: '', type: 'text', required: true, order: 1, selectOptions: [], markdownContent: '', notify: true }];
    const children = [
      { _id: 'r2', parentId: 'r1', name: 'Child B', description: '', type: 'text', required: true, order: 2, selectOptions: [], markdownContent: '', notify: true },
      { _id: 'r3', parentId: 'r1', name: 'Child A', description: '', type: 'text', required: true, order: 1, selectOptions: [], markdownContent: '', notify: true }
    ];
    Rule.find.mockImplementation((query) => {
      const base = query.parentId === null ? roots : (query.parentId === 'r1' ? children : []);
      return { sort: jest.fn().mockResolvedValue([...base].sort((a, b) => a.order - b.order)) };
    });

    const items = await buildItemsFromRules('d1');

    expect(items[0]).toMatchObject({ name: 'Root' });
    expect(items[0].children.map((c) => c.name)).toEqual(['Child A', 'Child B']);
    expect(items[0].children[0]).not.toHaveProperty('_id');
  });

  test('returns empty array when the document has no rules', async () => {
    Rule.find.mockImplementation(() => ({ sort: jest.fn().mockResolvedValue([]) }));

    const items = await buildItemsFromRules('d1');

    expect(items).toEqual([]);
  });
});

describe('templateService - saveTemplateFromSnapshot', () => {
  test('creates and saves a template when the name is available', async () => {
    Template.findOne.mockResolvedValue(null);
    const template = { _id: 't1', name: 'POV', items: [] };
    Template.mockImplementationOnce(function (data) {
      Object.assign(this, data);
      this.save = jest.fn().mockResolvedValue({ ...template });
      return this;
    });

    const saved = await saveTemplateFromSnapshot({ name: 'POV', description: 'Doc', items: [] });

    expect(Template.findOne).toHaveBeenCalledWith({ name: 'POV' });
    expect(saved).toMatchObject({ name: 'POV', description: 'Doc' });
  });

  test('rejects with TemplateNameExistsError when the name already exists (pre-check)', async () => {
    Template.findOne.mockResolvedValue({ _id: 't0', name: 'POV' });

    await expect(saveTemplateFromSnapshot({ name: 'POV', description: '', items: [] }))
      .rejects.toBeInstanceOf(TemplateNameExistsError);
    await expect(saveTemplateFromSnapshot({ name: 'POV', description: '', items: [] }))
      .rejects.toMatchObject({ code: 'TEMPLATE_NAME_EXISTS', message: 'Ya existe una plantilla llamada "POV"' });
    expect(Template).not.toHaveBeenCalled();
  });

  test('rejects with TemplateNameExistsError when save hits the unique index race (E11000)', async () => {
    Template.findOne.mockResolvedValue(null);
    Template.mockImplementationOnce(function (data) {
      Object.assign(this, data);
      this.save = jest.fn().mockRejectedValue(Object.assign(new Error('E11000 duplicate key'), { code: 11000 }));
      return this;
    });

    await expect(saveTemplateFromSnapshot({ name: 'POV', description: '', items: [] }))
      .rejects.toMatchObject({ code: 'TEMPLATE_NAME_EXISTS' });
  });

  test('rethrows non-duplicate errors from save', async () => {
    Template.findOne.mockResolvedValue(null);
    Template.mockImplementationOnce(function (data) {
      Object.assign(this, data);
      this.save = jest.fn().mockRejectedValue(new Error('DB down'));
      return this;
    });

    await expect(saveTemplateFromSnapshot({ name: 'POV', description: '', items: [] }))
      .rejects.toThrow('DB down');
  });

  test('defaults description to empty string when omitted', async () => {
    Template.findOne.mockResolvedValue(null);
    let captured;
    Template.mockImplementationOnce(function (data) {
      captured = data;
      this.save = jest.fn().mockResolvedValue(this);
      return this;
    });

    await saveTemplateFromSnapshot({ name: 'POV', items: [] });

    expect(captured.description).toBe('');
  });
});

describe('templateService - materializeTemplateItems', () => {
  test('creates a root rule without deadline and maps template fields', async () => {
    const results = await materializeTemplateItems({
      documentId: 'd1',
      items: [{
        name: 'Root',
        description: 'desc',
        type: 'text',
        required: true,
        order: 3,
        selectOptions: ['a'],
        markdownContent: '# x',
        notify: false
      }]
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      documentId: 'd1',
      parentId: null,
      name: 'Root',
      description: 'desc',
      type: 'text',
      required: true,
      order: 3,
      selectOptions: ['a'],
      markdownContent: '# x',
      notify: false
    });
    expect(results[0]).not.toHaveProperty('deadline');
    expect(Rule).toHaveBeenCalledTimes(1);
  });

  test('recursively wires children with the created parent id (pre-order)', async () => {
    const results = await materializeTemplateItems({
      documentId: 'd1',
      items: [
        { name: 'Root', type: 'text', children: [{ name: 'Child', type: 'text' }, { name: 'Child 2', type: 'text' }] }
      ]
    });

    expect(results).toHaveLength(3);
    expect(results[0].name).toBe('Root');
    expect(results[1].name).toBe('Child');
    expect(results[2].name).toBe('Child 2');
    expect(results[0].parentId).toBeNull();
    expect(results[1].parentId).toBe(results[0]._id);
    expect(results[2].parentId).toBe(results[0]._id);
  });

  test('nested children are materialized as descendants with correct depth', async () => {
    const results = await materializeTemplateItems({
      documentId: 'd1',
      items: [
        { name: 'R', type: 'text', children: [{ name: 'C', type: 'text', children: [{ name: 'GC', type: 'text' }] }] }
      ]
    });

    expect(results).toHaveLength(3);
    expect(results[0].parentId).toBeNull();
    expect(results[1].parentId).toBe(results[0]._id);
    expect(results[2].parentId).toBe(results[1]._id);
  });

  test('returns empty array when items is empty', async () => {
    const results = await materializeTemplateItems({ documentId: 'd1', items: [] });
    expect(results).toEqual([]);
    expect(Rule).not.toHaveBeenCalled();
  });

  test('defaults description/selectOptions/markdownContent when omitted', async () => {
    const results = await materializeTemplateItems({
      documentId: 'd1',
      items: [{ name: 'Root', type: 'text' }]
    });

    expect(results[0]).toMatchObject({ description: '', selectOptions: [], markdownContent: '' });
  });
});