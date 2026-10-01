jest.mock('../../src/models/Project', () => require('../mocks/mongooseModel')());
jest.mock('../../src/models/Document', () => require('../mocks/mongooseModel')());
jest.mock('../../src/models/Rule', () => require('../mocks/mongooseModel')());
jest.mock('../../src/models/Evidence', () => require('../mocks/mongooseModel')());
jest.mock('../../src/models/Event', () => require('../mocks/mongooseModel')());
jest.mock('../../src/services/eventSourcingService', () => ({
  createEvent: jest.fn().mockResolvedValue({})
}));

const Project = require('../../src/models/Project');
const Document = require('../../src/models/Document');
const Rule = require('../../src/models/Rule');
const { createEvent } = require('../../src/services/eventSourcingService');
const {
  getProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
  addParticipants,
  removeParticipant,
  changeProjectStatus
} = require('../../src/controllers/projectController');

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('projectController', () => {
  const WRITER = { _id: 'me', permissions: ['project:write'] };
  const READER = { _id: 'me', permissions: ['project:read'] };
  describe('getProjects', () => {
    test('returns projects with documentCount, totalRules and completedRules stats', async () => {
      const project = { _id: 'p1', toObject: () => ({ _id: 'p1', name: 'Project 1' }) };
      Project.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([project]) });
      Document.find.mockResolvedValue([{ _id: 'd1' }, { _id: 'd2' }]);
      Rule.countDocuments.mockResolvedValueOnce(10).mockResolvedValueOnce(4);
      const req = { user: WRITER, query: {} };
      const res = mockRes();

      await getProjects(req, res);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: [{ _id: 'p1', name: 'Project 1', documentCount: 2, totalRules: 10, completedRules: 4 }]
      });
    });

    test('passes status and priority filters to query', async () => {
      Project.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([]) });
      const req = { user: WRITER, query: { status: 'active', priority: 'alta' } };
      const res = mockRes();

      await getProjects(req, res);

      expect(Project.find).toHaveBeenCalledWith({ status: 'active', priority: 'alta' });
    });

    test('sorts by deadline ascending by default', async () => {
      const sortFn = jest.fn().mockResolvedValue([]);
      Project.find.mockReturnValue({ sort: sortFn });
      const req = { user: WRITER, query: {} };
      const res = mockRes();

      await getProjects(req, res);

      expect(sortFn).toHaveBeenCalledWith({ deadline: 1 });
    });

    test('sorts by name descending when order is desc', async () => {
      const sortFn = jest.fn().mockResolvedValue([]);
      Project.find.mockReturnValue({ sort: sortFn });
      const req = { user: WRITER, query: { sort: 'name', order: 'desc' } };
      const res = mockRes();

      await getProjects(req, res);

      expect(sortFn).toHaveBeenCalledWith({ name: -1 });
    });

    test('returns 500 on unexpected error', async () => {
      Project.find.mockImplementation(() => { throw new Error('DB down'); });
      const req = { user: WRITER, query: {} };
      const res = mockRes();

      await getProjects(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'INTERNAL_ERROR', message: 'DB down' } });
    });

    test('search filters by name using regex case-insensitive', async () => {
      Project.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([]) });
      const req = { user: WRITER, query: { search: 'azure' } };
      const res = mockRes();

      await getProjects(req, res);

      expect(Project.find).toHaveBeenCalledWith({
        $or: [
          { name: { $regex: 'azure', $options: 'i' } },
          { description: { $regex: 'azure', $options: 'i' } }
        ]
      });
    });

    test('search combines with status and priority filters', async () => {
      Project.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([]) });
      const req = { user: WRITER, query: { search: 'migracion', status: 'active', priority: 'alta' } };
      const res = mockRes();

      await getProjects(req, res);

      expect(Project.find).toHaveBeenCalledWith({
        status: 'active',
        priority: 'alta',
        $or: [
          { name: { $regex: 'migracion', $options: 'i' } },
          { description: { $regex: 'migracion', $options: 'i' } }
        ]
      });
    });

    test('empty search does not add $or filter', async () => {
      Project.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([]) });
      const req = { user: WRITER, query: { search: '' } };
      const res = mockRes();

      await getProjects(req, res);

      expect(Project.find).toHaveBeenCalledWith({});
    });

    test('without page/limit returns full array without pagination key (backward compatible)', async () => {
      const project = { _id: 'p1', toObject: () => ({ _id: 'p1', name: 'Project 1' }) };
      Project.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([project]) });
      Document.find.mockResolvedValue([]);
      Rule.countDocuments.mockResolvedValue(0);
      const req = { user: WRITER, query: {} };
      const res = mockRes();

      await getProjects(req, res);

      const payload = res.json.mock.calls[0][0];
      expect(payload.success).toBe(true);
      expect(Array.isArray(payload.data)).toBe(true);
      expect(payload).not.toHaveProperty('pagination');
    });

    test('returns paginated response with data and pagination when page/limit are present', async () => {
      const project = { _id: 'p1', toObject: () => ({ _id: 'p1', name: 'Project 1' }) };
      Project.countDocuments.mockResolvedValue(42);
      Project.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          skip: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([project])
          })
        })
      });
      Document.find.mockResolvedValue([{ _id: 'd1' }]);
      Rule.countDocuments.mockResolvedValueOnce(2).mockResolvedValueOnce(1);
      const req = { user: WRITER, query: { page: '1', limit: '10' } };
      const res = mockRes();

      await getProjects(req, res);

      expect(Project.countDocuments).toHaveBeenCalledWith({});
      expect(Document.find).toHaveBeenCalledTimes(1);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: [{ _id: 'p1', name: 'Project 1', documentCount: 1, totalRules: 2, completedRules: 1 }],
        pagination: { page: 1, limit: 10, total: 42, totalPages: 5 }
      });
    });

    test('paginates when only page is sent, defaulting limit to 10', async () => {
      Project.countDocuments.mockResolvedValue(15);
      Project.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          skip: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([]) })
        })
      });
      const req = { user: WRITER, query: { page: '2' } };
      const res = mockRes();

      await getProjects(req, res);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        pagination: { page: 2, limit: 10, total: 15, totalPages: 2 }
      }));
    });

    test('clamps invalid page/limit values to defaults', async () => {
      Project.countDocuments.mockResolvedValue(50);
      Project.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          skip: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([]) })
        })
      });
      const req = { user: WRITER, query: { page: 'abc', limit: '0' } };
      const res = mockRes();

      await getProjects(req, res);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        pagination: { page: 1, limit: 10, total: 50, totalPages: 5 }
      }));
    });

    test('caps limit at 100', async () => {
      Project.countDocuments.mockResolvedValue(500);
      Project.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          skip: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([]) })
        })
      });
      const req = { user: WRITER, query: { page: '1', limit: '500' } };
      const res = mockRes();

      await getProjects(req, res);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        pagination: { page: 1, limit: 100, total: 500, totalPages: 5 }
      }));
    });

    test('returns empty data with valid pagination when page exceeds totalPages', async () => {
      Project.countDocuments.mockResolvedValue(3);
      Project.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          skip: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([]) })
        })
      });
      const req = { user: WRITER, query: { page: '5', limit: '10' } };
      const res = mockRes();

      await getProjects(req, res);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: [],
        pagination: { page: 5, limit: 10, total: 3, totalPages: 1 }
      });
    });

    test('pagination total count respects existing filters (status + search)', async () => {
      Project.countDocuments.mockResolvedValue(7);
      Project.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          skip: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([]) })
        })
      });
      const req = { user: WRITER, query: { page: '1', limit: '10', status: 'active', search: 'azure' } };
      const res = mockRes();

      await getProjects(req, res);

      expect(Project.countDocuments).toHaveBeenCalledWith({
        status: 'active',
        $or: [
          { name: { $regex: 'azure', $options: 'i' } },
          { description: { $regex: 'azure', $options: 'i' } }
        ]
      });
    });
  });

  describe('getProject', () => {
    test('returns 404 when project does not exist', async () => {
      Project.findById.mockResolvedValue(null);
      const req = { user: WRITER, params: { id: 'p1' } };
      const res = mockRes();

      await getProject(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'NOT_FOUND', message: 'Project not found' } });
    });

    test('returns project with its documents sorted by order', async () => {
      Project.findById.mockResolvedValue({ _id: 'p1', toObject: () => ({ _id: 'p1', name: 'Project 1' }) });
      const sortFn = jest.fn().mockResolvedValue([{ _id: 'd1' }]);
      Document.find.mockReturnValue({ sort: sortFn });
      const req = { user: WRITER, params: { id: 'p1' } };
      const res = mockRes();

      await getProject(req, res);

      expect(sortFn).toHaveBeenCalledWith({ order: 1 });
      expect(res.json).toHaveBeenCalledWith({ success: true, data: { _id: 'p1', name: 'Project 1', documents: [{ _id: 'd1' }] } });
    });

    test('returns 500 on unexpected error', async () => {
      Project.findById.mockRejectedValue(new Error('DB down'));
      const req = { user: WRITER, params: { id: 'p1' } };
      const res = mockRes();

      await getProject(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'INTERNAL_ERROR', message: 'DB down' } });
    });
  });

  describe('createProject', () => {
    const validBody = { name: 'New Project', description: 'desc', priority: 'alta', deadline: '2026-12-31' };

    test('creates a project and emits project_created event', async () => {
      const req = { body: validBody };
      const res = mockRes();

      await createProject(req, res);

      expect(Project).toHaveBeenCalledWith(validBody);
      expect(createEvent).toHaveBeenCalledWith(
        'project_created',
        { name: 'New Project', priority: 'alta', deadline: '2026-12-31' },
        expect.objectContaining({ projectId: expect.anything() })
      );
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({ success: true, data: expect.objectContaining({ name: 'New Project' }) });
    });

    test('returns 400 VALIDATION_ERROR when required fields are missing', async () => {
      Project.mockImplementationOnce(function () {
        this.save = jest.fn().mockRejectedValue(new Error('Project validation failed: name: Path `name` is required.'));
        return this;
      });
      const req = { body: { description: 'desc', priority: 'alta', deadline: '2026-12-31' } };
      const res = mockRes();

      await createProject(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, error: expect.objectContaining({ code: 'VALIDATION_ERROR' }) }));
    });
  });

  describe('updateProject', () => {
    test('returns 404 when project does not exist', async () => {
      Project.findById.mockResolvedValue(null);
      const req = { params: { id: 'p1' }, body: { name: 'Updated' } };
      const res = mockRes();

      await updateProject(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'NOT_FOUND', message: 'Project not found' } });
    });

    test('returns 400 PROJECT_COMPLETED when project status is done', async () => {
      Project.findById.mockResolvedValue({ _id: 'p1', status: 'done' });
      const req = { params: { id: 'p1' }, body: { name: 'Updated' } };
      const res = mockRes();

      await updateProject(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'PROJECT_COMPLETED', message: 'Cannot modify completed project' } });
    });

    test('updates fields and emits project_updated event when status does not change', async () => {
      const project = { _id: 'p1', status: 'active', save: jest.fn().mockResolvedValue(true) };
      Project.findById.mockResolvedValue(project);
      const req = { params: { id: 'p1' }, body: { name: 'Updated' } };
      const res = mockRes();

      await updateProject(req, res);

      expect(project.name).toBe('Updated');
      expect(createEvent).toHaveBeenCalledWith('project_updated', { name: 'Updated' }, { projectId: 'p1' });
      expect(res.json).toHaveBeenCalledWith({ success: true, data: project });
    });

    test('emits project_updated event ignoring status field via whitelist', async () => {
      const project = { _id: 'p1', status: 'active', save: jest.fn().mockResolvedValue(true) };
      Project.findById.mockResolvedValue(project);
      const req = { params: { id: 'p1' }, body: { name: 'Updated', status: 'paused' } };
      const res = mockRes();

      await updateProject(req, res);

      expect(project.name).toBe('Updated');
      expect(project.status).toBe('active');
      expect(createEvent).toHaveBeenCalledWith('project_updated', { name: 'Updated' }, { projectId: 'p1' });
      expect(createEvent).not.toHaveBeenCalledWith('project_status_changed', expect.anything(), expect.anything());
    });

    test('ignores a body with only status and never emits project_status_changed', async () => {
      const project = { _id: 'p1', status: 'active', save: jest.fn().mockResolvedValue(true) };
      Project.findById.mockResolvedValue(project);
      const req = { params: { id: 'p1' }, body: { status: 'done' } };
      const res = mockRes();

      await updateProject(req, res);

      expect(project.status).toBe('active');
      expect(project.save).toHaveBeenCalled();
      expect(createEvent).toHaveBeenCalledWith('project_updated', {}, { projectId: 'p1' });
      expect(createEvent).not.toHaveBeenCalledWith('project_status_changed', expect.anything(), expect.anything());
    });

    test('does not emit project_status_changed when status is same value', async () => {
      const project = { _id: 'p1', status: 'active', save: jest.fn().mockResolvedValue(true) };
      Project.findById.mockResolvedValue(project);
      const req = { params: { id: 'p1' }, body: { status: 'active', name: 'Updated' } };
      const res = mockRes();

      await updateProject(req, res);

      expect(project.name).toBe('Updated');
      expect(createEvent).toHaveBeenCalledWith('project_updated', expect.objectContaining({ name: 'Updated' }), { projectId: 'p1' });
      expect(createEvent).not.toHaveBeenCalledWith('project_status_changed', expect.anything(), expect.anything());
    });

    test('ignores invalid status transitions and never returns INVALID_TRANSITION', async () => {
      const project = { _id: 'p1', status: 'paused', save: jest.fn().mockResolvedValue(true) };
      Project.findById.mockResolvedValue(project);
      const req = { params: { id: 'p1' }, body: { status: 'done' } };
      const res = mockRes();

      await updateProject(req, res);

      expect(project.status).toBe('paused');
      expect(res.status).not.toHaveBeenCalledWith(400);
      expect(createEvent).toHaveBeenCalledWith('project_updated', {}, { projectId: 'p1' });
      expect(res.json).toHaveBeenCalledWith({ success: true, data: project });
    });

    test('ignores status unavailable without applying it', async () => {
      const project = { _id: 'p1', status: 'active', save: jest.fn().mockResolvedValue(true) };
      Project.findById.mockResolvedValue(project);
      const req = { params: { id: 'p1' }, body: { status: 'unavailable' } };
      const res = mockRes();

      await updateProject(req, res);

      expect(project.status).toBe('active');
      expect(res.status).not.toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ success: true, data: project });
    });

    test('ignores fields outside the whitelist and mutates only editable fields', async () => {
      const project = { _id: 'p1', status: 'active', name: 'Antes', priority: 'baja', save: jest.fn().mockResolvedValue(true) };
      Project.findById.mockResolvedValue(project);
      const req = {
        params: { id: 'p1' },
        body: { _id: 'otro', status: 'done', createdAt: '2020-01-01', fluido: 'x', priority: 'alta', description: 'Nueva desc' }
      };
      const res = mockRes();

      await updateProject(req, res);

      expect(project._id).toBe('p1');
      expect(project.status).toBe('active');
      expect(project.createdAt).toBeUndefined();
      expect(project.fluido).toBeUndefined();
      expect(project.priority).toBe('alta');
      expect(project.description).toBe('Nueva desc');
      expect(createEvent).toHaveBeenCalledWith(
        'project_updated',
        expect.objectContaining({ priority: 'alta', description: 'Nueva desc' }),
        { projectId: 'p1' }
      );
      expect(createEvent).not.toHaveBeenCalledWith(
        'project_updated',
        expect.objectContaining({ _id: 'otro', status: 'done', fluido: 'x' }),
        expect.anything()
      );
    });

    test('returns 400 VALIDATION_ERROR on invalid priority', async () => {
      const project = {
        _id: 'p1',
        status: 'active',
        save: jest.fn().mockRejectedValue(new Error('Project validation failed: priority: `urgente` is not a valid enum value for path `priority`.'))
      };
      Project.findById.mockResolvedValue(project);
      const req = { params: { id: 'p1' }, body: { priority: 'urgente' } };
      const res = mockRes();

      await updateProject(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, error: expect.objectContaining({ code: 'VALIDATION_ERROR' }) }));
    });
  });

  describe('changeProjectStatus (feature 124)', () => {
    // Tabla de referencia: statusService.js:4-9
    // project: { active: ['done','paused'], paused: ['active'], done: [], unavailable: [] }
    const makeProject = (status) => ({ _id: 'p1', name: 'Migración DB', priority: 'media', status, save: jest.fn().mockResolvedValue(true) });

    describe('transiciones permitidas por la tabla', () => {
      test('active -> paused persiste y emite project_status_changed', async () => {
        const project = makeProject('active');
        Project.findById.mockResolvedValue(project);

        await changeProjectStatus({ params: { id: 'p1' }, body: { status: 'paused' } }, mockRes());

        expect(project.status).toBe('paused');
        expect(project.save).toHaveBeenCalled();
        expect(createEvent).toHaveBeenCalledWith(
          'project_status_changed',
          { previousStatus: 'active', newStatus: 'paused', reason: 'manual' },
          { projectId: 'p1' }
        );
      });

      test('paused -> active (reanudar) persiste y emite el evento', async () => {
        const project = makeProject('paused');
        Project.findById.mockResolvedValue(project);

        await changeProjectStatus({ params: { id: 'p1' }, body: { status: 'active' } }, mockRes());

        expect(project.status).toBe('active');
        expect(createEvent).toHaveBeenCalledWith(
          'project_status_changed',
          { previousStatus: 'paused', newStatus: 'active', reason: 'manual' },
          { projectId: 'p1' }
        );
      });

      test('active -> done persiste y emite el evento', async () => {
        const project = makeProject('active');
        Project.findById.mockResolvedValue(project);

        const res = mockRes();
        await changeProjectStatus({ params: { id: 'p1' }, body: { status: 'done' } }, res);

        expect(project.status).toBe('done');
        expect(createEvent).toHaveBeenCalledWith(
          'project_status_changed',
          { previousStatus: 'active', newStatus: 'done', reason: 'manual' },
          { projectId: 'p1' }
        );
        expect(res.json).toHaveBeenCalledWith({ success: true, data: project });
      });

      test('deja intactos los campos ajenos al estado', async () => {
        const project = makeProject('active');
        Project.findById.mockResolvedValue(project);

        await changeProjectStatus({ params: { id: 'p1' }, body: { status: 'paused' } }, mockRes());

        expect(project.name).toBe('Migración DB');
        expect(project.priority).toBe('media');
      });

      test('repetir el estado actual es un no-op tolerated', async () => {
        const project = makeProject('active');
        Project.findById.mockResolvedValue(project);

        const res = mockRes();
        await changeProjectStatus({ params: { id: 'p1' }, body: { status: 'active' } }, res);

        expect(res.status).not.toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ success: true, data: project });
      });
    });

    describe('transiciones prohibidas por la tabla', () => {
      test.each([
        ['paused', 'done'],
        ['done', 'active'],
        ['unavailable', 'active']
      ])('rechaza %s -> %s con 400 INVALID_TRANSITION y no emite evento', async (from, to) => {
        const project = makeProject(from);
        Project.findById.mockResolvedValue(project);

        const res = mockRes();
        await changeProjectStatus({ params: { id: 'p1' }, body: { status: to } }, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
          success: false,
          error: expect.objectContaining({ code: 'INVALID_TRANSITION' })
        }));
        expect(project.save).not.toHaveBeenCalled();
        expect(createEvent).not.toHaveBeenCalled();
      });
    });

    describe('validacion del body', () => {
      // D-002: unavailable NO pertenece al whitelist. No es un olvido: el soft-delete
      // conserva un unico camino (DELETE) y su evento propio.
      test.each([
        ['unavailable', 'el endpoint no asigna unavailable; el unico camino es DELETE'],
        ['cancelado', 'estado desconocido'],
        ['', 'estado vacio']
      ])('rechaza status "%s" con 400 (%s)', async (status) => {
        const project = makeProject('active');
        Project.findById.mockResolvedValue(project);

        const res = mockRes();
        await changeProjectStatus({ params: { id: 'p1' }, body: { status } }, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
          success: false,
          error: expect.objectContaining({ code: 'VALIDATION_ERROR' })
        }));
        expect(project.save).not.toHaveBeenCalled();
        expect(createEvent).not.toHaveBeenCalled();
      });

      test('rechaza un body sin status con 400', async () => {
        const project = makeProject('active');
        Project.findById.mockResolvedValue(project);

        const res = mockRes();
        await changeProjectStatus({ params: { id: 'p1' }, body: {} }, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
          error: expect.objectContaining({ code: 'VALIDATION_ERROR' })
        }));
        expect(createEvent).not.toHaveBeenCalled();
      });
    });

    test('devuelve 404 si el proyecto no existe', async () => {
      Project.findById.mockResolvedValue(null);

      const res = mockRes();
      await changeProjectStatus({ params: { id: 'nope' }, body: { status: 'paused' } }, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(createEvent).not.toHaveBeenCalled();
    });

    // El catch distingue InvalidTransitionError (400) de cualquier otro fallo. Sin este
    // test el catch generico queda sin cubrir y un error de persistencia se reporta como
    // si fuera una transicion invalida.
    test('un fallo al persistir responde 500 y no como INVALID_TRANSITION', async () => {
      const project = makeProject('active');
      project.save.mockRejectedValue(new Error('connection lost'));
      Project.findById.mockResolvedValue(project);

      const res = mockRes();
      await changeProjectStatus({ params: { id: 'p1' }, body: { status: 'paused' } }, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        error: expect.not.objectContaining({ code: 'INVALID_TRANSITION' })
      }));
      expect(createEvent).not.toHaveBeenCalled();
    });
  });

  describe('deleteProject', () => {
    test('returns 404 when project does not exist', async () => {
      Project.findById.mockResolvedValue(null);
      const req = { user: WRITER, params: { id: 'p1' } };
      const res = mockRes();

      await deleteProject(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'NOT_FOUND', message: 'Project not found' } });
    });

    test('returns 400 PROJECT_UNAVAILABLE when project is already unavailable', async () => {
      Project.findById.mockResolvedValue({ _id: 'p1', status: 'unavailable' });
      const req = { user: WRITER, params: { id: 'p1' } };
      const res = mockRes();

      await deleteProject(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'PROJECT_UNAVAILABLE', message: 'Project is already unavailable' } });
    });

    test('sets status to unavailable (soft delete) and emits project_status_changed event', async () => {
      const project = { _id: 'p1', status: 'active', save: jest.fn().mockResolvedValue(true) };
      Project.findById.mockResolvedValue(project);
      const req = { user: WRITER, params: { id: 'p1' } };
      const res = mockRes();

      await deleteProject(req, res);

      expect(project.status).toBe('unavailable');
      expect(createEvent).toHaveBeenCalledWith(
        'project_status_changed',
        { previousStatus: 'active', newStatus: 'unavailable' },
        { projectId: 'p1' }
      );
      expect(res.json).toHaveBeenCalledWith({ success: true, data: project });
    });

    test('returns 500 on unexpected error', async () => {
      Project.findById.mockRejectedValue(new Error('DB down'));
      const req = { user: WRITER, params: { id: 'p1' } };
      const res = mockRes();

      await deleteProject(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'INTERNAL_ERROR', message: 'DB down' } });
    });
  });

  describe('visibility (feature 079)', () => {
    test('getProjects filters by participants when the user lacks project:write', async () => {
      Project.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([]) });
      const res = mockRes();

      await getProjects({ user: READER, query: {} }, res);

      expect(Project.find).toHaveBeenCalledWith({ participants: 'me' });
    });

    test('getProjects combines the participants filter with status and search', async () => {
      Project.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([]) });
      const res = mockRes();

      await getProjects({ user: READER, query: { status: 'active', search: 'azure' } }, res);

      expect(Project.find).toHaveBeenCalledWith({
        status: 'active',
        $or: [
          { name: { $regex: 'azure', $options: 'i' } },
          { description: { $regex: 'azure', $options: 'i' } }
        ],
        participants: 'me'
      });
    });

    test('getProjects does not filter when the user has project:write', async () => {
      Project.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([]) });
      const res = mockRes();

      await getProjects({ user: WRITER, query: {} }, res);

      expect(Project.find).toHaveBeenCalledWith({});
    });

    test('getProject returns 403 FORBIDDEN when not participant and no project:write', async () => {
      Project.findById.mockResolvedValue({ _id: 'p1', participants: ['other'], toObject: () => ({ _id: 'p1' }) });
      const res = mockRes();

      await getProject({ params: { id: 'p1' }, user: READER }, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'FORBIDDEN', message: 'No eres participante del proyecto' } });
      expect(Document.find).not.toHaveBeenCalled();
    });

    test('getProject returns the project to a participant without project:write', async () => {
      Project.findById.mockResolvedValue({ _id: 'p1', participants: ['me', 'other'], toObject: () => ({ _id: 'p1', name: 'Project 1' }) });
      const sortFn = jest.fn().mockResolvedValue([]);
      Document.find.mockReturnValue({ sort: sortFn });
      const res = mockRes();

      await getProject({ params: { id: 'p1' }, user: READER }, res);

      expect(res.json).toHaveBeenCalledWith({ success: true, data: { _id: 'p1', name: 'Project 1', documents: [] } });
    });

    test('getProject returns the project to a writer that is not a participant', async () => {
      Project.findById.mockResolvedValue({ _id: 'p1', participants: ['other'], toObject: () => ({ _id: 'p1', name: 'Project 1' }) });
      const sortFn = jest.fn().mockResolvedValue([]);
      Document.find.mockReturnValue({ sort: sortFn });
      const res = mockRes();

      await getProject({ params: { id: 'p1' }, user: WRITER }, res);

      expect(res.json).toHaveBeenCalledWith({ success: true, data: { _id: 'p1', name: 'Project 1', documents: [] } });
    });
  });

  describe('addParticipants', () => {
    const VALID_IDS = ['507f1f77bcf86cd799439011', '507f1f77bcf86cd799439012'];

    test('returns 400 VALIDATION_ERROR when userIds is missing or not an array', async () => {
      const missing = mockRes();
      const notArray = mockRes();

      await addParticipants({ params: { id: 'p1' }, body: {} }, missing);
      await addParticipants({ params: { id: 'p1' }, body: { userIds: 'x' } }, notArray);

      expect(missing.status).toHaveBeenCalledWith(400);
      expect(notArray.status).toHaveBeenCalledWith(400);
      expect(missing.json).toHaveBeenCalledWith(expect.objectContaining({ error: { code: 'VALIDATION_ERROR', message: expect.any(String) } }));
      expect(Project.findById).not.toHaveBeenCalled();
    });

    test('returns 400 VALIDATION_ERROR when any userId is not a valid ObjectId', async () => {
      const res = mockRes();

      await addParticipants({ params: { id: 'p1' }, body: { userIds: ['507f1f77bcf86cd799439011', 'not-an-id'] } }, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: { code: 'VALIDATION_ERROR', message: expect.any(String) } }));
      expect(Project.findById).not.toHaveBeenCalled();
    });

    test('returns 404 when the project does not exist', async () => {
      Project.findById.mockResolvedValue(null);
      const res = mockRes();

      await addParticipants({ params: { id: 'p1' }, body: { userIds: VALID_IDS } }, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'NOT_FOUND', message: 'Project not found' } });
    });

    test('adds multiple userIds avoiding duplicates in the input and against existing participants', async () => {
      const project = new Project({ participants: ['507f1f77bcf86cd799439011'] });
      Project.findById.mockResolvedValue(project);
      const res = mockRes();

      await addParticipants({ params: { id: 'p1' }, body: { userIds: [...VALID_IDS, ...VALID_IDS] } }, res);

      expect(project.save).toHaveBeenCalledTimes(1);
      expect(project.participants).toEqual(['507f1f77bcf86cd799439011', '507f1f77bcf86cd799439012']);
      expect(res.json).toHaveBeenCalledWith({ success: true, data: { participants: project.participants } });
      expect(createEvent).toHaveBeenCalledWith('project_participant_added', { participants: ['507f1f77bcf86cd799439012'] }, { projectId: project._id });
    });

    test('returns 200 unchanged for an empty userIds array and delegates unexpected errors to 500', async () => {
      const project = new Project({ participants: ['507f1f77bcf86cd799439011'] });
      Project.findById.mockResolvedValue(project);
      const res = mockRes();

      await addParticipants({ params: { id: 'p1' }, body: { userIds: [] } }, res);

      expect(project.save).toHaveBeenCalledTimes(1);
      expect(res.json).toHaveBeenCalledWith({ success: true, data: { participants: ['507f1f77bcf86cd799439011'] } });

      Project.findById.mockRejectedValue(new Error('DB down'));
      const errorRes = mockRes();
      await addParticipants({ params: { id: 'p1' }, body: { userIds: VALID_IDS } }, errorRes);
      expect(errorRes.status).toHaveBeenCalledWith(500);
    });
  });

  describe('removeParticipant', () => {
    test('returns 400 VALIDATION_ERROR when userId is not a valid ObjectId', async () => {
      const res = mockRes();

      await removeParticipant({ params: { id: 'p1', userId: 'not-an-id' } }, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(Project.findById).not.toHaveBeenCalled();
    });

    test('returns 404 when the project does not exist', async () => {
      Project.findById.mockResolvedValue(null);
      const res = mockRes();

      await removeParticipant({ params: { id: 'p1', userId: '507f1f77bcf86cd799439011' } }, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'NOT_FOUND', message: 'Project not found' } });
    });

    test('removes the participant and responds 200 with the updated list', async () => {
      const project = new Project({ participants: ['507f1f77bcf86cd799439011', '507f1f77bcf86cd799439012'] });
      Project.findById.mockResolvedValue(project);
      const res = mockRes();

      await removeParticipant({ params: { id: 'p1', userId: '507f1f77bcf86cd799439011' } }, res);

      expect(project.save).toHaveBeenCalledTimes(1);
      expect(project.participants).toEqual(['507f1f77bcf86cd799439012']);
      expect(res.json).toHaveBeenCalledWith({ success: true, data: { participants: ['507f1f77bcf86cd799439012'] } });
      expect(createEvent).toHaveBeenCalledWith('project_participant_removed', { userId: '507f1f77bcf86cd799439011' }, { projectId: project._id });
    });

    test('is idempotent when the user is not a participant', async () => {
      const project = new Project({ participants: ['507f1f77bcf86cd799439012'] });
      Project.findById.mockResolvedValue(project);
      const res = mockRes();

      await removeParticipant({ params: { id: 'p1', userId: '507f1f77bcf86cd799439011' } }, res);

      expect(project.save).toHaveBeenCalledTimes(1);
      expect(project.participants).toEqual(['507f1f77bcf86cd799439012']);
      expect(res.json).toHaveBeenCalledWith({ success: true, data: { participants: ['507f1f77bcf86cd799439012'] } });
    });

    test('delegates unexpected errors to 500', async () => {
      Project.findById.mockRejectedValue(new Error('DB down'));
      const res = mockRes();

      await removeParticipant({ params: { id: 'p1', userId: '507f1f77bcf86cd799439011' } }, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'INTERNAL_ERROR', message: 'DB down' } });
    });
  });
});

// Feature 113 (AC6): la regla de participacion tiene una sola definicion. Estos tests no
// repiten los casos de 079: comprueban que getProjects y getProject no pueden divergir de
// documentAccessService, que es quien decide.
describe('una sola definicion de la regla de participacion (AC6)', () => {
  const { visibleProjectFilter, hasProjectAccess } = require('../../src/services/documentAccessService');
  const mongoose = require('mongoose');

  const WRITER = { _id: 'me', permissions: ['project:write'] };
  const READER = { _id: 'me', permissions: ['project:read'] };

  describe('getProjects construye la query con el helper, no con una copia de la regla', () => {
    test('el filtro de la query es exactamente lo que devuelve visibleProjectFilter', async () => {
      Project.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([]) });

      await getProjects({ user: READER, query: { status: 'active' } }, mockRes());

      expect(Project.find).toHaveBeenCalledWith({ status: 'active', ...visibleProjectFilter(READER) });
    });

    test('un escritor recibe el filtro vacio del helper', async () => {
      Project.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([]) });

      await getProjects({ user: WRITER, query: {} }, mockRes());

      expect(Project.find).toHaveBeenCalledWith({ ...visibleProjectFilter(WRITER) });
    });

    test('el filtro de participacion sobrevive a search, status y priority a la vez', async () => {
      Project.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([]) });

      await getProjects({
        user: READER,
        query: { status: 'active', priority: 'alta', search: 'azure' }
      }, mockRes());

      const [query] = Project.find.mock.calls[0];
      expect(query.participants).toBe(READER._id);
      expect(query.status).toBe('active');
      expect(query.priority).toBe('alta');
      expect(query.$or).toHaveLength(2);
    });
  });

  describe('getProject decide con hasProjectAccess, no con la regla reimplementada', () => {
    const CASES = [
      { name: 'lector no participante', user: READER, participants: ['otro'], allowed: false },
      { name: 'lector participante', user: READER, participants: ['me', 'otro'], allowed: true },
      { name: 'escritor no participante', user: WRITER, participants: ['otro'], allowed: true },
      { name: 'lector con ObjectId como participante', user: { _id: '507f1f77bcf86cd799439011', permissions: ['project:read'] }, participants: [new mongoose.Types.ObjectId('507f1f77bcf86cd799439011')], allowed: true },
      { name: 'lector con ObjectId ajeno', user: { _id: '507f1f77bcf86cd799439011', permissions: ['project:read'] }, participants: [new mongoose.Types.ObjectId('507f1f77bcf86cd799439012')], allowed: false },
      { name: 'proyecto sin participants', user: READER, participants: undefined, allowed: false }
    ];

    test.each(CASES)('$name: el status coincide con hasProjectAccess', async ({ user, participants, allowed }) => {
      Project.findById.mockResolvedValue({ _id: 'p1', participants, toObject: () => ({ _id: 'p1' }) });
      Document.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([]) });
      const res = mockRes();

      await getProject({ params: { id: 'p1' }, user }, res);

      expect(hasProjectAccess(user, { _id: 'p1', participants })).toBe(allowed);
      if (allowed) {
        expect(res.json).toHaveBeenCalledWith({ success: true, data: { _id: 'p1', documents: [] } });
      } else {
        expect(res.status).toHaveBeenCalledWith(403);
        expect(Document.find).not.toHaveBeenCalled();
      }
    });

    test('el mensaje de 403 sigue siendo NOT_A_PARTICIPANT', async () => {
      Project.findById.mockResolvedValue({ _id: 'p1', participants: [], toObject: () => ({ _id: 'p1' }) });
      const res = mockRes();

      await getProject({ params: { id: 'p1' }, user: READER }, res);

      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: { code: 'FORBIDDEN', message: 'No eres participante del proyecto' }
      });
    });
  });

  test('el dashboard y el listado de proyectos comparten el mismo helper', async () => {
    const { getStats } = require('../../src/controllers/dashboardController');
    Project.countDocuments.mockResolvedValue(0);
    Project.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });

    await getStats({ query: {}, user: READER }, mockRes());

    expect(Project.find).toHaveBeenCalledWith(visibleProjectFilter(READER), '_id');
  });
});
