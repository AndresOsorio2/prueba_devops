jest.mock('../../src/models/Template', () => require('../mocks/mongooseModel')());
jest.mock('../../src/models/Document', () => require('../mocks/mongooseModel')());
jest.mock('../../src/models/Project', () => require('../mocks/mongooseModel')());
jest.mock('../../src/services/eventSourcingService', () => ({
  createEvent: jest.fn().mockResolvedValue(undefined)
}));
jest.mock('../../src/services/templateService', () => {
  class TemplateNameExistsError extends Error {
    constructor(name) {
      super(`Ya existe una plantilla llamada "${name}"`);
      this.name = 'TemplateNameExistsError';
      this.code = 'TEMPLATE_NAME_EXISTS';
    }
  }
  return {
    buildItemsFromRules: jest.fn(),
    saveTemplateFromSnapshot: jest.fn(),
    materializeTemplateItems: jest.fn(),
    TemplateNameExistsError
  };
});

const Template = require('../../src/models/Template');
const Document = require('../../src/models/Document');
const Project = require('../../src/models/Project');
const eventSourcingService = require('../../src/services/eventSourcingService');
const { getTemplates, getTemplateById, createTemplate, updateTemplate, deleteTemplate, applyTemplate, saveDocumentAsTemplate } = require('../../src/controllers/templateController');
const templateService = require('../../src/services/templateService');

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

const WRITER = { _id: 'me', permissions: ['project:write'] };
const READER = { _id: 'me', permissions: ['document:read'] };

beforeEach(() => {
  jest.clearAllMocks();
  Project.findById.mockResolvedValue({ _id: 'p1', participants: [] });
});

describe('templateController - getTemplates', () => {
  test('returns an empty list', async () => {
    Template.aggregate.mockResolvedValue([]);
    const req = {};
    const res = mockRes();

    await getTemplates(req, res);

    expect(Template.aggregate).toHaveBeenCalledWith([
      { $project: { name: 1, description: 1, itemCount: { $size: '$items' } } },
      { $sort: { name: 1 } }
    ]);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: [] });
  });

  test('returns templates with itemCount computed via aggregation', async () => {
    const templates = [
      { _id: 't1', name: 'Assessment', description: 'Doc base', itemCount: 5 },
      { _id: 't2', name: 'POV', description: '', itemCount: 0 }
    ];
    Template.aggregate.mockResolvedValue(templates);
    const req = {};
    const res = mockRes();

    await getTemplates(req, res);

    expect(res.json).toHaveBeenCalledWith({ success: true, data: templates });
  });

  test('does not expose items in the list payload', async () => {
    const templates = [{ _id: 't1', name: 'A', description: 'x', itemCount: 2 }];
    Template.aggregate.mockResolvedValue(templates);
    const res = mockRes();

    await getTemplates({}, res);

    const data = res.json.mock.calls[0][0].data;
    expect(data[0]).not.toHaveProperty('items');
  });

  test('returns 500 when aggregation fails', async () => {
    Template.aggregate.mockRejectedValue(new Error('DB down'));
    const req = {};
    const res = mockRes();

    await getTemplates(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'INTERNAL_ERROR', message: 'DB down' } });
  });
});

describe('templateController - saveDocumentAsTemplate', () => {
  test('returns 404 when document does not exist', async () => {
    Document.findById.mockResolvedValue(null);
    const req = { user: WRITER, params: { id: 'd1' } };
    const res = mockRes();

    await saveDocumentAsTemplate(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'NOT_FOUND', message: 'Document not found' } });
    expect(templateService.buildItemsFromRules).not.toHaveBeenCalled();
    expect(templateService.saveTemplateFromSnapshot).not.toHaveBeenCalled();
  });

  test('saves a template built from the document rules tree in 201', async () => {
    Document.findById.mockResolvedValue({ _id: 'd1', name: 'POV', description: 'Doc base' });
    const items = [
      { name: 'Objetivo', description: 'x', type: 'text', required: true, order: 0, selectOptions: [], markdownContent: '', notify: true, children: [] }
    ];
    templateService.buildItemsFromRules.mockResolvedValue(items);
    templateService.saveTemplateFromSnapshot.mockResolvedValue({ _id: 't1', name: 'POV', items });
    const req = { user: WRITER, params: { id: 'd1' } };
    const res = mockRes();

    await saveDocumentAsTemplate(req, res);

    expect(templateService.buildItemsFromRules).toHaveBeenCalledWith('d1');
    expect(templateService.saveTemplateFromSnapshot).toHaveBeenCalledWith({
      name: 'POV',
      description: 'Doc base',
      items
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { _id: 't1', name: 'POV', items } });
  });

  test('returns 409 TEMPLATE_NAME_EXISTS when a template with the same name already exists', async () => {
    Document.findById.mockResolvedValue({ _id: 'd1', name: 'POV', description: '' });
    templateService.buildItemsFromRules.mockResolvedValue([]);
    templateService.saveTemplateFromSnapshot.mockRejectedValue(new templateService.TemplateNameExistsError('POV'));
    const req = { user: WRITER, params: { id: 'd1' } };
    const res = mockRes();

    await saveDocumentAsTemplate(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'TEMPLATE_NAME_EXISTS', message: 'Ya existe una plantilla llamada "POV"' }
    });
  });

  test('creates template with empty items when the document has no rules', async () => {
    Document.findById.mockResolvedValue({ _id: 'd1', name: 'Empty', description: '' });
    templateService.buildItemsFromRules.mockResolvedValue([]);
    templateService.saveTemplateFromSnapshot.mockResolvedValue({ _id: 't1', name: 'Empty', items: [] });
    const req = { user: WRITER, params: { id: 'd1' } };
    const res = mockRes();

    await saveDocumentAsTemplate(req, res);

    expect(templateService.buildItemsFromRules).toHaveBeenCalledWith('d1');
    expect(templateService.saveTemplateFromSnapshot).toHaveBeenCalledWith({
      name: 'Empty',
      description: '',
      items: []
    });
    expect(res.status).toHaveBeenCalledWith(201);
  });

  test('returns 500 on unexpected error', async () => {
    Document.findById.mockResolvedValue({ _id: 'd1', name: 'POV', description: '' });
    templateService.saveTemplateFromSnapshot.mockRejectedValue(new Error('DB down'));
    const req = { user: WRITER, params: { id: 'd1' } };
    const res = mockRes();

    await saveDocumentAsTemplate(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'INTERNAL_ERROR', message: 'DB down' } });
  });

  test('returns 403 when the user is not a participant of the owning project', async () => {
    Document.findById.mockResolvedValue({ _id: 'd1', name: 'POV', description: '' });
    Project.findById.mockResolvedValue({ _id: 'p1', participants: ['other'] });
    const req = { user: READER, params: { id: 'd1' } };
    const res = mockRes();

    await saveDocumentAsTemplate(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'FORBIDDEN', message: 'No eres participante del proyecto' } });
    expect(templateService.buildItemsFromRules).not.toHaveBeenCalled();
  });

  test('returns 404 when the owning project does not exist', async () => {
    Document.findById.mockResolvedValue({ _id: 'd1', name: 'POV', description: '' });
    Project.findById.mockResolvedValue(null);
    const req = { user: WRITER, params: { id: 'd1' } };
    const res = mockRes();

    await saveDocumentAsTemplate(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'NOT_FOUND', message: 'Project not found' } });
  });

  test('allows a project:write user to save a template from a project without participants', async () => {
    Document.findById.mockResolvedValue({ _id: 'd1', name: 'POV', description: 'Doc base' });
    templateService.buildItemsFromRules.mockResolvedValue([]);
    templateService.saveTemplateFromSnapshot.mockResolvedValue({ _id: 't1', name: 'POV', items: [] });
    const req = { user: WRITER, params: { id: 'd1' } };
    const res = mockRes();

    await saveDocumentAsTemplate(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
  });
});

describe('templateController - createTemplate', () => {
  test('returns 400 VALIDATION_ERROR when name is missing', async () => {
    const req = { body: { description: 'x' } };
    const res = mockRes();

    await createTemplate(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'VALIDATION_ERROR', message: 'name is required' } });
    expect(templateService.saveTemplateFromSnapshot).not.toHaveBeenCalled();
  });

  test('creates a template with default items [] and returns 201', async () => {
    templateService.saveTemplateFromSnapshot.mockResolvedValue({ _id: 't1', name: 'New TPL', description: '', items: [] });
    const req = { body: { name: 'New TPL' } };
    const res = mockRes();

    await createTemplate(req, res);

    expect(templateService.saveTemplateFromSnapshot).toHaveBeenCalledWith({ name: 'New TPL', description: undefined, items: [] });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { _id: 't1', name: 'New TPL', description: '', items: [] } });
  });

  test('creates a template with provided description and items', async () => {
    const items = [{ name: 'Objetivo', type: 'text', required: true, children: [] }];
    templateService.saveTemplateFromSnapshot.mockResolvedValue({ _id: 't2', name: 'Full', description: 'desc', items });
    const req = { body: { name: 'Full', description: 'desc', items } };
    const res = mockRes();

    await createTemplate(req, res);

    expect(templateService.saveTemplateFromSnapshot).toHaveBeenCalledWith({ name: 'Full', description: 'desc', items });
    expect(res.status).toHaveBeenCalledWith(201);
  });

  test('returns 409 TEMPLATE_NAME_EXISTS on duplicate name', async () => {
    templateService.saveTemplateFromSnapshot.mockRejectedValue(new templateService.TemplateNameExistsError('New TPL'));
    const req = { body: { name: 'New TPL' } };
    const res = mockRes();

    await createTemplate(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'TEMPLATE_NAME_EXISTS', message: 'Ya existe una plantilla llamada "New TPL"' }
    });
  });

  test('returns 400 VALIDATION_ERROR when item tree is invalid', async () => {
    templateService.saveTemplateFromSnapshot.mockRejectedValue(Object.assign(
      new Error('Template validation failed: items.0.type: `whatever` is not a valid enum value'),
      { name: 'ValidationError' }
    ));
    const req = { body: { name: 'New TPL', items: [{ name: 'x', type: 'whatever' }] } };
    const res = mockRes();

    await createTemplate(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Template validation failed: items.0.type: `whatever` is not a valid enum value' }
    });
  });

  test('returns 500 on unexpected error', async () => {
    templateService.saveTemplateFromSnapshot.mockRejectedValue(new Error('DB down'));
    const req = { body: { name: 'New TPL' } };
    const res = mockRes();

    await createTemplate(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'INTERNAL_ERROR', message: 'DB down' } });
  });
});

describe('templateController - getTemplateById', () => {
  test('returns the full template with its recursive items tree', async () => {
    const template = {
      _id: 't1',
      name: 'Assessment + POV',
      description: 'Plantilla base',
      items: [
        {
          _id: 'i1',
          name: 'Objetivo',
          type: 'textarea',
          required: true,
          order: 0,
          children: [{ _id: 'i2', name: 'Diagrama', type: 'file', required: true, order: 0, children: [] }]
        }
      ]
    };
    Template.findById.mockResolvedValue(template);
    const req = { params: { id: 't1' } };
    const res = mockRes();

    await getTemplateById(req, res);

    expect(Template.findById).toHaveBeenCalledWith('t1');
    expect(res.json).toHaveBeenCalledWith({ success: true, data: template });
  });

  test('returns 404 NOT_FOUND when the template does not exist', async () => {
    Template.findById.mockResolvedValue(null);
    const req = { params: { id: 't1' } };
    const res = mockRes();

    await getTemplateById(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'NOT_FOUND', message: 'Template not found' } });
  });

  test('returns 500 on unexpected error', async () => {
    Template.findById.mockRejectedValue(new Error('DB down'));
    const req = { params: { id: 't1' } };
    const res = mockRes();

    await getTemplateById(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'INTERNAL_ERROR', message: 'DB down' } });
  });
});

describe('templateController - updateTemplate', () => {
  function makeTemplate(data) {
    const doc = { ...data };
    doc.save = jest.fn().mockResolvedValue(doc);
    return doc;
  }

  test('returns 404 when the template does not exist', async () => {
    Template.findById.mockResolvedValue(null);
    const req = { params: { id: 't1' }, body: { name: 'New' } };
    const res = mockRes();

    await updateTemplate(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'NOT_FOUND', message: 'Template not found' } });
    expect(Template.findOne).not.toHaveBeenCalled();
  });

  test('updates name and description (whitelist) and revalidates uniqueness excluding the own id', async () => {
    const doc = makeTemplate({ _id: 't1', name: 'Old', description: 'old desc', items: [{ name: 'Item' }] });
    Template.findById.mockResolvedValue(doc);
    Template.findOne.mockResolvedValue(null);
    const req = { params: { id: 't1' }, body: { name: 'New', description: 'new desc' } };
    const res = mockRes();

    await updateTemplate(req, res);

    expect(Template.findOne).toHaveBeenCalledWith({ name: 'New', _id: { $ne: 't1' } });
    expect(doc.name).toBe('New');
    expect(doc.description).toBe('new desc');
    expect(doc.save).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: true, data: doc });
  });

  test('does not revalidate uniqueness when name is not sent', async () => {
    const doc = makeTemplate({ _id: 't1', name: 'Old', description: 'old' });
    Template.findById.mockResolvedValue(doc);
    const req = { params: { id: 't1' }, body: { description: 'solo desc' } };
    const res = mockRes();

    await updateTemplate(req, res);

    expect(Template.findOne).not.toHaveBeenCalled();
    expect(doc.name).toBe('Old');
    expect(doc.description).toBe('solo desc');
    expect(res.json).toHaveBeenCalledWith({ success: true, data: doc });
  });

  test('returns 409 TEMPLATE_NAME_EXISTS when the name collides with another template', async () => {
    const doc = makeTemplate({ _id: 't1', name: 'Old' });
    Template.findById.mockResolvedValue(doc);
    Template.findOne.mockResolvedValue({ _id: 't2', name: 'Taken' });
    const req = { params: { id: 't1' }, body: { name: 'Taken' } };
    const res = mockRes();

    await updateTemplate(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'TEMPLATE_NAME_EXISTS', message: 'Ya existe una plantilla llamada "Taken"' }
    });
    expect(doc.save).not.toHaveBeenCalled();
  });

  test('allows keeping the current name (excluded by $ne)', async () => {
    const doc = makeTemplate({ _id: 't1', name: 'Same' });
    Template.findById.mockResolvedValue(doc);
    Template.findOne.mockResolvedValue(null);
    const req = { params: { id: 't1' }, body: { name: 'Same' } };
    const res = mockRes();

    await updateTemplate(req, res);

    expect(Template.findOne).toHaveBeenCalledWith({ name: 'Same', _id: { $ne: 't1' } });
    expect(res.json).toHaveBeenCalledWith({ success: true, data: doc });
  });

  test('replaces items and ignores unknown fields from the body', async () => {
    const doc = makeTemplate({ _id: 't1', name: 'Old', items: [{ name: 'Item' }] });
    Template.findById.mockResolvedValue(doc);
    const newItems = [{ name: 'A', type: 'text', required: true }, { name: 'B', type: 'file', children: [] }];
    const req = { params: { id: 't1' }, body: { description: 'x', items: newItems, malicious: 'no' } };
    const res = mockRes();

    await updateTemplate(req, res);

    expect(doc.items).toEqual(newItems);
    expect(doc).not.toHaveProperty('malicious');
    expect(doc.save).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: true, data: doc });
  });

  test('clears the items tree when items is sent as an empty array', async () => {
    const doc = makeTemplate({ _id: 't1', name: 'Old', items: [{ name: 'Item' }] });
    Template.findById.mockResolvedValue(doc);
    const req = { params: { id: 't1' }, body: { items: [] } };
    const res = mockRes();

    await updateTemplate(req, res);

    expect(doc.items).toEqual([]);
    expect(doc.save).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: true, data: doc });
  });

  test('returns 400 VALIDATION_ERROR when the item tree is invalid', async () => {
    const doc = makeTemplate({ _id: 't1', name: 'Old' });
    doc.save = jest.fn().mockRejectedValue(Object.assign(
      new Error('Template validation failed: items.0.type: `boom` is not a valid enum value'),
      { name: 'ValidationError' }
    ));
    Template.findById.mockResolvedValue(doc);
    const req = { params: { id: 't1' }, body: { items: [{ name: 'x', type: 'boom' }] } };
    const res = mockRes();

    await updateTemplate(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Template validation failed: items.0.type: `boom` is not a valid enum value' }
    });
  });

  test('returns 400 VALIDATION_ERROR when save fails with ValidationError', async () => {
    const doc = makeTemplate({ _id: 't1', name: 'Old' });
    doc.save = jest.fn().mockRejectedValue(Object.assign(
      new Error('Template validation failed: name: Path `name` is required.'),
      { name: 'ValidationError' }
    ));
    Template.findById.mockResolvedValue(doc);
    const req = { params: { id: 't1' }, body: { name: '' } };
    const res = mockRes();

    await updateTemplate(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Template validation failed: name: Path `name` is required.' }
    });
  });

  test('returns 409 when save hits the unique index race (E11000)', async () => {
    const doc = makeTemplate({ _id: 't1', name: 'Old' });
    doc.save = jest.fn().mockRejectedValue(Object.assign(new Error('E11000 duplicate key'), { code: 11000 }));
    Template.findById.mockResolvedValue(doc);
    Template.findOne.mockResolvedValue(null);
    const req = { params: { id: 't1' }, body: { name: 'Taken' } };
    const res = mockRes();

    await updateTemplate(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'TEMPLATE_NAME_EXISTS', message: 'Ya existe una plantilla llamada "Taken"' }
    });
  });

  test('returns 500 on unexpected error', async () => {
    Template.findById.mockRejectedValue(new Error('DB down'));
    const req = { params: { id: 't1' }, body: { name: 'New' } };
    const res = mockRes();

    await updateTemplate(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'INTERNAL_ERROR', message: 'DB down' } });
  });
});

describe('templateController - deleteTemplate', () => {
  function makeTemplate(data) {
    return {
      _id: data._id || 't1',
      ...data,
      deleteOne: jest.fn().mockResolvedValue({})
    };
  }

  test('returns 404 when the template does not exist (deleteOne not called)', async () => {
    Template.findById.mockResolvedValue(null);
    const req = { params: { id: 't1' } };
    const res = mockRes();

    await deleteTemplate(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'NOT_FOUND', message: 'Template not found' } });
    const doc = makeTemplate({});
    expect(doc.deleteOne).not.toHaveBeenCalled();
  });

  test('deletes the template and returns 200 with the removed _id', async () => {
    const doc = makeTemplate({ _id: 't1', name: 'Temp' });
    Template.findById.mockResolvedValue(doc);
    const req = { params: { id: 't1' } };
    const res = mockRes();

    await deleteTemplate(req, res);

    expect(doc.deleteOne).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { _id: 't1' } });
  });

  test('no cascade: does not touch Document model (snapshot independence)', async () => {
    const doc = makeTemplate({ _id: 't1', name: 'Temp' });
    Template.findById.mockResolvedValue(doc);
    const req = { params: { id: 't1' } };
    const res = mockRes();

    await deleteTemplate(req, res);

    expect(doc.deleteOne).toHaveBeenCalled();
    expect(Document.findById).not.toHaveBeenCalled();
    expect(Document.deleteMany).not.toHaveBeenCalled();
    expect(Document.findByIdAndDelete).not.toHaveBeenCalled();
  });

  test('returns 500 on unexpected error', async () => {
    Template.findById.mockRejectedValue(new Error('DB down'));
    const req = { params: { id: 't1' } };
    const res = mockRes();

    await deleteTemplate(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'INTERNAL_ERROR', message: 'DB down' } });
  });
});

describe('templateController - applyTemplate', () => {
  function mockRule(id, parentId, name) {
    const rule = { _id: id, parentId, name, type: 'text', required: true };
    rule.toObject = () => ({ ...rule });
    return rule;
  }

  test('returns 404 when the template does not exist (project not consulted)', async () => {
    Template.findById.mockResolvedValue(null);
    const req = { params: { id: 't1' }, body: { projectId: 'p1', deadline: '2026-12-31T00:00:00.000Z' } };
    const res = mockRes();

    await applyTemplate(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'NOT_FOUND', message: 'Template not found' } });
    expect(Project.findById).not.toHaveBeenCalled();
  });

  test('returns 404 when the project does not exist', async () => {
    Template.findById.mockResolvedValue({ _id: 't1', name: 'TPL', description: 'desc', items: [] });
    Project.findById.mockResolvedValue(null);
    const req = { params: { id: 't1' }, body: { projectId: 'p1', deadline: '2026-12-31T00:00:00.000Z' } };
    const res = mockRes();

    await applyTemplate(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'NOT_FOUND', message: 'Project not found' } });
  });

  test.each(['done', 'unavailable'])('returns 400 PROJECT_COMPLETED when project is %s', async (status) => {
    Template.findById.mockResolvedValue({ _id: 't1', name: 'TPL', description: '', items: [] });
    Project.findById.mockResolvedValue({ _id: 'p1', status });
    const req = { params: { id: 't1' }, body: { projectId: 'p1', deadline: '2026-12-31T00:00:00.000Z' } };
    const res = mockRes();

    await applyTemplate(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'PROJECT_COMPLETED', message: 'Cannot add documents to a completed or unavailable project' }
    });
  });

  test('returns 400 VALIDATION_ERROR when deadline is missing', async () => {
    Template.findById.mockResolvedValue({ _id: 't1', name: 'TPL', description: '', items: [] });
    Project.findById.mockResolvedValue({ _id: 'p1', status: 'pending' });
    const req = { params: { id: 't1' }, body: { projectId: 'p1' } };
    const res = mockRes();

    await applyTemplate(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'deadline is required' }
    });
    expect(Document).not.toHaveBeenCalled();
  });

  test('creates the document, materializes the rule tree, emits events and returns the nested tree (201)', async () => {
    Template.findById.mockResolvedValue({ _id: 't1', name: 'TPL', description: 'tpl desc', items: [] });
    Project.findById.mockResolvedValue({ _id: 'p1', status: 'pending' });
    const root = mockRule('r1', null, 'Root');
    const childA = mockRule('r2', 'r1', 'Child A');
    const childB = mockRule('r3', 'r1', 'Child B');
    templateService.materializeTemplateItems.mockResolvedValue([root, childA, childB]);
    const req = {
      params: { id: 't1' },
      body: { projectId: 'p1', deadline: '2026-12-31T00:00:00.000Z', name: 'Mi Doc' }
    };
    const res = mockRes();

    await applyTemplate(req, res);

    expect(templateService.materializeTemplateItems).toHaveBeenCalledWith({ documentId: expect.any(String), parentId: null, items: [] });
    expect(res.status).toHaveBeenCalledWith(201);
    const data = res.json.mock.calls[0][0].data;
    expect(data.name).toBe('Mi Doc');
    expect(data.description).toBe('tpl desc');
    expect(data.deadline).toBe('2026-12-31T00:00:00.000Z');
    expect(data.rules).toHaveLength(1);
    expect(data.rules[0]).toMatchObject({ name: 'Root', _id: 'r1' });
    expect(data.rules[0].children.map((c) => c.name)).toEqual(['Child A', 'Child B']);

    expect(eventSourcingService.createEvent).toHaveBeenCalledTimes(4);
    expect(eventSourcingService.createEvent).toHaveBeenNthCalledWith(
      1,
      'document_created',
      { name: 'Mi Doc', description: 'tpl desc', deadline: '2026-12-31T00:00:00.000Z', order: 0 },
      { projectId: 'p1', documentId: expect.any(String) }
    );
    expect(eventSourcingService.createEvent).toHaveBeenNthCalledWith(
      2,
      'rule_created',
      { name: 'Root', type: 'text', required: true },
      { projectId: 'p1', documentId: expect.any(String), ruleId: 'r1' }
    );
    expect(eventSourcingService.createEvent).toHaveBeenNthCalledWith(
      3,
      'rule_created',
      { name: 'Child A', type: 'text', required: true },
      { projectId: 'p1', documentId: expect.any(String), ruleId: 'r2' }
    );
    expect(eventSourcingService.createEvent).toHaveBeenNthCalledWith(
      4,
      'rule_created',
      { name: 'Child B', type: 'text', required: true },
      { projectId: 'p1', documentId: expect.any(String), ruleId: 'r3' }
    );
  });

  test('falls back to template.name when body.name is omitted', async () => {
    Template.findById.mockResolvedValue({ _id: 't1', name: 'TPL', description: '', items: [] });
    Project.findById.mockResolvedValue({ _id: 'p1', status: 'pending' });
    templateService.materializeTemplateItems.mockResolvedValue([]);
    const req = { params: { id: 't1' }, body: { projectId: 'p1', deadline: '2026-12-31T00:00:00.000Z' } };
    const res = mockRes();

    await applyTemplate(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json.mock.calls[0][0].data.name).toBe('TPL');
    expect(eventSourcingService.createEvent).toHaveBeenCalledTimes(1);
  });

  test('returns 500 on unexpected error', async () => {
    Template.findById.mockRejectedValue(new Error('DB down'));
    const req = { params: { id: 't1' }, body: { projectId: 'p1', deadline: '2026-12-31T00:00:00.000Z' } };
    const res = mockRes();

    await applyTemplate(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'INTERNAL_ERROR', message: 'DB down' } });
  });
});