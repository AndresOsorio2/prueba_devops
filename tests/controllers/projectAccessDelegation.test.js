jest.mock('../../src/models/Project', () => require('../mocks/mongooseModel')());
jest.mock('../../src/models/Document', () => require('../mocks/mongooseModel')());
jest.mock('../../src/models/Rule', () => require('../mocks/mongooseModel')());
jest.mock('../../src/models/Evidence', () => require('../mocks/mongooseModel')());
jest.mock('../../src/models/Event', () => require('../mocks/mongooseModel')());
jest.mock('../../src/services/eventSourcingService', () => ({ createEvent: jest.fn().mockResolvedValue({}) }));

// Los espias delegan en las implementaciones reales, asi que el comportamiento del resto del
// archivo no cambia: lo unico que se verifica aqui es QUIEN decide, no el resultado.
jest.mock('../../src/services/documentAccessService', () => {
  const actual = jest.requireActual('../../src/services/documentAccessService');
  return {
    ...actual,
    visibleProjectFilter: jest.fn(actual.visibleProjectFilter),
    hasProjectAccess: jest.fn(actual.hasProjectAccess)
  };
});

const Project = require('../../src/models/Project');
const Document = require('../../src/models/Document');
const { getProjects, getProject } = require('../../src/controllers/projectController');
const { getStats } = require('../../src/controllers/dashboardController');
const { visibleProjectFilter, hasProjectAccess } = require('../../src/services/documentAccessService');

const READER = { _id: 'me', permissions: ['project:read'] };
const WRITER = { _id: 'me', permissions: ['project:write'] };

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

beforeEach(() => {
  jest.clearAllMocks();
});

// Feature 113 (AC6): "una sola definicion". Si un controller vuelve a escribir la regla de
// participacion en linea, deja de llamar al helper y estos tests se ponen en rojo.
describe('AC6: projectController no reimplementa la regla de participacion', () => {
  test('getProjects pide el filtro a visibleProjectFilter', async () => {
    Project.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([]) });

    await getProjects({ user: READER, query: { status: 'active' } }, mockRes());

    expect(visibleProjectFilter).toHaveBeenCalledWith(READER);
    expect(Project.find).toHaveBeenCalledWith({ status: 'active', participants: READER._id });
  });

  test('getProjects aplica el filtro del helper tambien al escritor', async () => {
    Project.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([]) });

    await getProjects({ user: WRITER, query: {} }, mockRes());

    expect(visibleProjectFilter).toHaveBeenCalledWith(WRITER);
  });

  test('getProject consulta a hasProjectAccess en vez de comparar participants en linea', async () => {
    const project = { _id: 'p1', participants: ['otro'], toObject: () => ({ _id: 'p1' }) };
    Project.findById.mockResolvedValue(project);
    const res = mockRes();

    await getProject({ params: { id: 'p1' }, user: READER }, res);

    expect(hasProjectAccess).toHaveBeenCalledWith(READER, project);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('getProject no consulta a hasProjectAccess si el proyecto no existe', async () => {
    Project.findById.mockResolvedValue(null);

    await getProject({ params: { id: 'nope' }, user: READER }, mockRes());

    expect(hasProjectAccess).not.toHaveBeenCalled();
  });

  test('getProject delega con el mismo user que recibio, sin reconstruirlo', async () => {
    const project = { _id: 'p1', participants: ['me'], toObject: () => ({ _id: 'p1' }) };
    Project.findById.mockResolvedValue(project);
    Document.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([]) });

    await getProject({ params: { id: 'p1' }, user: READER }, mockRes());

    expect(hasProjectAccess).toHaveBeenCalledWith(READER, project);
  });
});

describe('AC6: el dashboard usa el mismo helper que el listado de proyectos', () => {
  test('getStats pide el filtro a visibleProjectFilter', async () => {
    Project.countDocuments.mockResolvedValue(0);
    Project.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });

    await getStats({ query: {}, user: READER }, mockRes());

    expect(visibleProjectFilter).toHaveBeenCalledWith(READER);
  });
});