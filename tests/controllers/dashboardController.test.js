jest.mock('../../src/models/Project', () => require('../mocks/mongooseModel')());
jest.mock('../../src/models/Document', () => require('../mocks/mongooseModel')());
jest.mock('../../src/models/Rule', () => require('../mocks/mongooseModel')());

const Project = require('../../src/models/Project');
const Document = require('../../src/models/Document');
const Rule = require('../../src/models/Rule');
const { getStats, getAlerts } = require('../../src/controllers/dashboardController');

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('dashboardController', () => {
  describe('getStats', () => {
    test('returns global statistics with correct query filters', async () => {
      Project.countDocuments
        .mockResolvedValueOnce(5)
        .mockResolvedValueOnce(3)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(1);
      Document.countDocuments.mockResolvedValue(10);
      Rule.countDocuments
        .mockResolvedValueOnce(25)
        .mockResolvedValueOnce(12)
        .mockResolvedValueOnce(13);
      const req = { query: {} };
      const res = mockRes();

      await getStats(req, res);

      expect(Project.countDocuments).toHaveBeenNthCalledWith(1, { status: { $ne: 'unavailable' } });
      expect(Project.countDocuments).toHaveBeenNthCalledWith(2, { status: 'active' });
      expect(Project.countDocuments).toHaveBeenNthCalledWith(3, { status: 'done' });
      expect(Project.countDocuments).toHaveBeenNthCalledWith(4, { status: 'paused' });
      expect(Project.countDocuments).toHaveBeenNthCalledWith(5, { priority: 'alta', status: { $ne: 'unavailable' } });
      expect(Project.countDocuments).toHaveBeenNthCalledWith(6, { priority: 'media', status: { $ne: 'unavailable' } });
      expect(Project.countDocuments).toHaveBeenNthCalledWith(7, { priority: 'baja', status: { $ne: 'unavailable' } });
      expect(Rule.countDocuments).toHaveBeenCalledTimes(3);
      expect(Rule.countDocuments).toHaveBeenNthCalledWith(2, { status: 'done' });
      expect(Rule.countDocuments).toHaveBeenNthCalledWith(3, { status: 'pending' });
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: {
          totalProjects: 5,
          activeProjects: 3,
          completedProjects: 1,
          pausedProjects: 1,
          totalDocuments: 10,
          totalRules: 25,
          completedRules: 12,
          pendingRules: 13,
          projectsByPriority: { alta: 2, media: 2, baja: 1 }
        }
      });
    });

    test('returns 500 on unexpected error', async () => {
      Project.countDocuments.mockRejectedValue(new Error('DB down'));
      const req = { query: {} };
      const res = mockRes();

      await getStats(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'INTERNAL_ERROR', message: 'DB down' } });
    });
  });

  describe('getAlerts', () => {
    test('excludes projects with status unavailable from query', async () => {
      const now = new Date('2026-08-20T00:00:00Z');
      jest.useFakeTimers().setSystemTime(now);

      Project.find.mockResolvedValue([]);
      const req = { query: {} };
      const res = mockRes();

      await getAlerts(req, res);

      expect(Project.find).toHaveBeenCalledWith({ status: { $ne: 'unavailable' } });
      jest.useRealTimers();
    });

    test('returns overdue project alert with required=true', async () => {
      const now = new Date('2026-08-20T00:00:00Z');
      jest.useFakeTimers().setSystemTime(now);

      Project.find.mockResolvedValue([
        { _id: 'p1', name: 'Project 1', deadline: new Date('2026-08-15'), priority: 'alta' }
      ]);
      Document.find.mockResolvedValue([]);
      Rule.find.mockResolvedValue([]);
      const req = { query: {} };
      const res = mockRes();

      await getAlerts(req, res);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          overdue: [
            { type: 'project', id: 'p1', name: 'Project 1', projectName: 'Project 1', deadline: new Date('2026-08-15'), daysOverdue: 5, required: true }
          ],
          upcoming: []
        })
      }));
      jest.useRealTimers();
    });

    test('returns upcoming project alert with priority', async () => {
      const now = new Date('2026-08-20T00:00:00Z');
      jest.useFakeTimers().setSystemTime(now);

      Project.find.mockResolvedValue([
        { _id: 'p2', name: 'Project 2', deadline: new Date('2026-08-23'), priority: 'media' }
      ]);
      Document.find.mockResolvedValue([]);
      Rule.find.mockResolvedValue([]);
      const req = { query: { days: '7' } };
      const res = mockRes();

      await getAlerts(req, res);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          overdue: [],
          upcoming: [
            { type: 'project', id: 'p2', name: 'Project 2', deadline: new Date('2026-08-23'), daysUntilDeadline: 3, priority: 'media' }
          ]
        })
      }));
      jest.useRealTimers();
    });

    test('excludes projects with deadline beyond the window', async () => {
      const now = new Date('2026-08-20T00:00:00Z');
      jest.useFakeTimers().setSystemTime(now);

      Project.find.mockResolvedValue([
        { _id: 'p3', name: 'Project 3', deadline: new Date('2026-09-20'), priority: 'baja' }
      ]);
      Document.find.mockResolvedValue([]);
      Rule.find.mockResolvedValue([]);
      const req = { query: { days: '7' } };
      const res = mockRes();

      await getAlerts(req, res);

      const body = res.json.mock.calls[0][0];
      expect(body.data.overdue).toEqual([]);
      expect(body.data.upcoming).toEqual([]);
      jest.useRealTimers();
    });

    test('returns overdue document alert with required=true', async () => {
      const now = new Date('2026-08-20T00:00:00Z');
      jest.useFakeTimers().setSystemTime(now);

      Project.find.mockResolvedValue([
        { _id: 'p1', name: 'Project 1', deadline: new Date('2026-09-01'), priority: 'alta' }
      ]);
      Document.find.mockResolvedValue([
        { _id: 'd1', name: 'Doc 1', projectId: 'p1', deadline: new Date('2026-08-10') }
      ]);
      Rule.find.mockResolvedValue([]);
      const req = { query: {} };
      const res = mockRes();

      await getAlerts(req, res);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          overdue: [
            { type: 'document', id: 'd1', name: 'Doc 1', projectName: 'Project 1', deadline: new Date('2026-08-10'), daysOverdue: 10, required: true }
          ]
        })
      }));
      jest.useRealTimers();
    });

    test('returns upcoming document alert within window', async () => {
      const now = new Date('2026-08-20T00:00:00Z');
      jest.useFakeTimers().setSystemTime(now);

      Project.find.mockResolvedValue([
        { _id: 'p1', name: 'Project 1', deadline: new Date('2026-09-01'), priority: 'alta' }
      ]);
      Document.find.mockResolvedValue([
        { _id: 'd1', name: 'Doc 1', projectId: 'p1', deadline: new Date('2026-08-24') }
      ]);
      Rule.find.mockResolvedValue([]);
      const req = { query: { days: '7' } };
      const res = mockRes();

      await getAlerts(req, res);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          upcoming: expect.arrayContaining([
            expect.objectContaining({ type: 'document', id: 'd1', name: 'Doc 1', projectName: 'Project 1', deadline: new Date('2026-08-24'), daysUntilDeadline: 4 })
          ])
        })
      }));
      jest.useRealTimers();
    });

    test('queries rules with deadline exists and not null', async () => {
      const now = new Date('2026-08-20T00:00:00Z');
      jest.useFakeTimers().setSystemTime(now);

      Project.find.mockResolvedValue([
        { _id: 'p1', name: 'Project 1', deadline: new Date('2026-09-01'), priority: 'alta' }
      ]);
      Document.find.mockResolvedValue([
        { _id: 'd1', name: 'Doc 1', projectId: 'p1', deadline: new Date('2026-09-01') }
      ]);
      Rule.find.mockResolvedValue([]);
      const req = { query: {} };
      const res = mockRes();

      await getAlerts(req, res);

      expect(Rule.find).toHaveBeenCalledWith({ documentId: 'd1', deadline: { $exists: true, $ne: null } });
      jest.useRealTimers();
    });

    test('returns overdue rule alert with required field', async () => {
      const now = new Date('2026-08-20T00:00:00Z');
      jest.useFakeTimers().setSystemTime(now);

      Project.find.mockResolvedValue([
        { _id: 'p1', name: 'Project 1', deadline: new Date('2026-09-01'), priority: 'alta' }
      ]);
      Document.find.mockResolvedValue([
        { _id: 'd1', name: 'Doc 1', projectId: 'p1', deadline: new Date('2026-09-01') }
      ]);
      Rule.find.mockResolvedValue([
        { _id: 'r1', name: 'Rule 1', documentId: 'd1', deadline: new Date('2026-08-05'), required: true }
      ]);
      const req = { query: {} };
      const res = mockRes();

      await getAlerts(req, res);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          overdue: [
            { type: 'rule', id: 'r1', name: 'Rule 1', projectName: 'Project 1', deadline: new Date('2026-08-05'), daysOverdue: 15, required: true }
          ]
        })
      }));
      jest.useRealTimers();
    });

    test('returns upcoming rule alert within window', async () => {
      const now = new Date('2026-08-20T00:00:00Z');
      jest.useFakeTimers().setSystemTime(now);

      Project.find.mockResolvedValue([
        { _id: 'p1', name: 'Project 1', deadline: new Date('2026-09-01'), priority: 'alta' }
      ]);
      Document.find.mockResolvedValue([
        { _id: 'd1', name: 'Doc 1', projectId: 'p1', deadline: new Date('2026-09-01') }
      ]);
      Rule.find.mockResolvedValue([
        { _id: 'r1', name: 'Rule 1', documentId: 'd1', deadline: new Date('2026-08-22'), required: false }
      ]);
      const req = { query: { days: '7' } };
      const res = mockRes();

      await getAlerts(req, res);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          upcoming: expect.arrayContaining([
            expect.objectContaining({ type: 'rule', id: 'r1', name: 'Rule 1', projectName: 'Project 1', deadline: new Date('2026-08-22'), daysUntilDeadline: 2 })
          ])
        })
      }));
      jest.useRealTimers();
    });

    test('sorts overdue and upcoming by deadline ascending', async () => {
      const now = new Date('2026-08-20T00:00:00Z');
      jest.useFakeTimers().setSystemTime(now);

      Project.find.mockResolvedValue([
        { _id: 'p1', name: 'Later', deadline: new Date('2026-08-18'), priority: 'alta' },
        { _id: 'p2', name: 'Earlier', deadline: new Date('2026-08-12'), priority: 'media' }
      ]);
      Document.find.mockResolvedValue([]);
      Rule.find.mockResolvedValue([]);
      const req = { query: {} };
      const res = mockRes();

      await getAlerts(req, res);

      const body = res.json.mock.calls[0][0];
      expect(body.data.overdue[0].name).toBe('Earlier');
      expect(body.data.overdue[1].name).toBe('Later');
      jest.useRealTimers();
    });

    test('sorts upcoming by deadline ascending', async () => {
      const now = new Date('2026-08-20T00:00:00Z');
      jest.useFakeTimers().setSystemTime(now);

      Project.find.mockResolvedValue([
        { _id: 'p1', name: 'Later', deadline: new Date('2026-08-25'), priority: 'alta' },
        { _id: 'p2', name: 'Sooner', deadline: new Date('2026-08-21'), priority: 'media' }
      ]);
      Document.find.mockResolvedValue([]);
      Rule.find.mockResolvedValue([]);
      const req = { query: { days: '7' } };
      const res = mockRes();

      await getAlerts(req, res);

      const body = res.json.mock.calls[0][0];
      expect(body.data.upcoming[0].name).toBe('Sooner');
      expect(body.data.upcoming[1].name).toBe('Later');
      jest.useRealTimers();
    });

    test('uses default 7-day window when days param is not provided', async () => {
      const now = new Date('2026-08-20T00:00:00Z');
      jest.useFakeTimers().setSystemTime(now);

      Project.find.mockResolvedValue([
        { _id: 'p1', name: 'Project 1', deadline: new Date('2026-08-26'), priority: 'alta' }
      ]);
      Document.find.mockResolvedValue([]);
      Rule.find.mockResolvedValue([]);
      const req = { query: {} };
      const res = mockRes();

      await getAlerts(req, res);

      const body = res.json.mock.calls[0][0];
      expect(body.data.upcoming).toHaveLength(1);
      expect(body.data.upcoming[0].daysUntilDeadline).toBe(6);
      jest.useRealTimers();
    });

    test('falls back to default 7-day window when days param is invalid', async () => {
      const now = new Date('2026-08-20T00:00:00Z');
      jest.useFakeTimers().setSystemTime(now);

      Project.find.mockResolvedValue([
        { _id: 'p1', name: 'Project 1', deadline: new Date('2026-08-26'), priority: 'alta' }
      ]);
      Document.find.mockResolvedValue([]);
      Rule.find.mockResolvedValue([]);
      const req = { query: { days: 'abc' } };
      const res = mockRes();

      await getAlerts(req, res);

      const body = res.json.mock.calls[0][0];
      expect(body.data.upcoming).toHaveLength(1);
      expect(body.data.upcoming[0].daysUntilDeadline).toBe(6);
      jest.useRealTimers();
    });

    test('returns empty arrays when no deadlines exist', async () => {
      Project.find.mockResolvedValue([]);
      const req = { query: {} };
      const res = mockRes();

      await getAlerts(req, res);

      expect(res.json).toHaveBeenCalledWith({ success: true, data: { overdue: [], upcoming: [] } });
    });

    test('returns 500 on unexpected error', async () => {
      Project.find.mockRejectedValue(new Error('DB down'));
      const req = { query: {} };
      const res = mockRes();

      await getAlerts(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'INTERNAL_ERROR', message: 'DB down' } });
    });
  });
});

// Feature 113 (D-106/D-109): getStats tiene dos ramas. La global no se toca; la filtrada resuelve
// la cascada projectIds -> docIds -> conteos.
describe('getStats authorization scope', () => {
  const WRITER = { _id: 'writer-1', permissions: ['project:write', 'project:read'] };
  const READER = { _id: 'reader-1', permissions: ['project:read'] };

  function mockAllCounts(value) {
    Project.countDocuments.mockResolvedValue(value);
    Document.countDocuments.mockResolvedValue(value);
    Rule.countDocuments.mockResolvedValue(value);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockAllCounts(0);
  });

  describe('global scope: a project:write user keeps the exact current behaviour (AC3)', () => {
    test('runs the 11 aggregations with the current unfiltered filters', async () => {
      mockAllCounts(7);
      const res = mockRes();

      await getStats({ query: {}, user: WRITER }, res);

      expect(Project.countDocuments).toHaveBeenNthCalledWith(1, { status: { $ne: 'unavailable' } });
      expect(Project.countDocuments).toHaveBeenNthCalledWith(2, { status: 'active' });
      expect(Project.countDocuments).toHaveBeenNthCalledWith(3, { status: 'done' });
      expect(Project.countDocuments).toHaveBeenNthCalledWith(4, { status: 'paused' });
      expect(Project.countDocuments).toHaveBeenNthCalledWith(5, { priority: 'alta', status: { $ne: 'unavailable' } });
      expect(Project.countDocuments).toHaveBeenNthCalledWith(6, { priority: 'media', status: { $ne: 'unavailable' } });
      expect(Project.countDocuments).toHaveBeenNthCalledWith(7, { priority: 'baja', status: { $ne: 'unavailable' } });
      // Sin project:write no se toca esto: hoy no filtra y hoy no filtramos.
      expect(Document.countDocuments).toHaveBeenCalledWith();
      // La primera cuenta de reglas va sin argumentos: es el conteo global que ya existia.
      expect(Rule.countDocuments.mock.calls[0]).toHaveLength(0);
      expect(Rule.countDocuments).toHaveBeenNthCalledWith(2, { status: 'done' });
      expect(Rule.countDocuments).toHaveBeenNthCalledWith(3, { status: 'pending' });
    });

    test('never resolves project or document ids', async () => {
      mockAllCounts(1);

      await getStats({ query: {}, user: WRITER }, mockRes());

      expect(Project.find).not.toHaveBeenCalled();
      expect(Document.find).not.toHaveBeenCalled();
    });

    test('returns the same numbers it would without a user', async () => {
      Project.countDocuments
        .mockResolvedValueOnce(5).mockResolvedValueOnce(3).mockResolvedValueOnce(1)
        .mockResolvedValueOnce(1).mockResolvedValueOnce(2).mockResolvedValueOnce(2)
        .mockResolvedValueOnce(1);
      Document.countDocuments.mockResolvedValue(10);
      Rule.countDocuments.mockResolvedValueOnce(25).mockResolvedValueOnce(12).mockResolvedValueOnce(13);
      const writerRes = mockRes();

      await getStats({ query: {}, user: WRITER }, writerRes);

      expect(writerRes.json).toHaveBeenCalledWith({
        success: true,
        data: {
          totalProjects: 5, activeProjects: 3, completedProjects: 1, pausedProjects: 1,
          totalDocuments: 10, totalRules: 25, completedRules: 12, pendingRules: 13,
          projectsByPriority: { alta: 2, media: 2, baja: 1 }
        }
      });
    });
  });

  describe('filtered scope: a reader only sees their own projects (AC2, AC4)', () => {
    beforeEach(() => {
      Project.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([{ _id: 'p-mine' }]) });
      Document.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([{ _id: 'd1' }, { _id: 'd2' }]) });
    });

    test('scopes the project counts by participation', async () => {
      await getStats({ query: {}, user: READER }, mockRes());

      expect(Project.countDocuments).toHaveBeenNthCalledWith(1, {
        status: { $ne: 'unavailable' }, participants: READER._id
      });
      expect(Project.countDocuments).toHaveBeenNthCalledWith(2, {
        status: 'active', participants: READER._id
      });
    });

    test('resolves the visible project ids by participation only, without a status filter (D-109)', async () => {
      await getStats({ query: {}, user: READER }, mockRes());

      expect(Project.find).toHaveBeenCalledWith({ participants: READER._id }, '_id');
    });

    test('resolves the document ids scoped to the visible projects', async () => {
      await getStats({ query: {}, user: READER }, mockRes());

      expect(Document.find).toHaveBeenCalledWith({ projectId: { $in: ['p-mine'] } }, '_id');
    });

    test('derives totalDocuments from the resolved set instead of counting globally (AC4)', async () => {
      const res = mockRes();

      await getStats({ query: {}, user: READER }, res);

      expect(Document.countDocuments).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ totalDocuments: 2 })
        })
      );
    });

    test('counts the rules scoped to the visible documents (AC2)', async () => {
      const res = mockRes();

      await getStats({ query: {}, user: READER }, res);

      expect(Rule.countDocuments).toHaveBeenNthCalledWith(1, { documentId: { $in: ['d1', 'd2'] } });
      expect(Rule.countDocuments).toHaveBeenNthCalledWith(2, {
        documentId: { $in: ['d1', 'd2'] }, status: 'done'
      });
      expect(Rule.countDocuments).toHaveBeenNthCalledWith(3, {
        documentId: { $in: ['d1', 'd2'] }, status: 'pending'
      });
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ totalRules: 0, completedRules: 0, pendingRules: 0 })
        })
      );
    });

    test('keeps the response shape identical to the global branch', async () => {
      const res = mockRes();

      await getStats({ query: {}, user: READER }, res);

      expect(Object.keys(res.json.mock.calls[0][0].data).sort()).toEqual([
        'activeProjects', 'completedProjects', 'completedRules', 'pausedProjects',
        'pendingRules', 'projectsByPriority', 'totalDocuments', 'totalProjects', 'totalRules'
      ]);
    });

    test('does not query rules at all when there are no visible projects (AC5)', async () => {
      Project.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });

      await getStats({ query: {}, user: READER }, mockRes());

      expect(Document.find).not.toHaveBeenCalled();
      expect(Rule.countDocuments).not.toHaveBeenCalled();
    });

    test('returns the full shape with zeroes and never emits $in: [] (AC5)', async () => {
      Project.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
      const res = mockRes();

      await getStats({ query: {}, user: READER }, res);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: {
          totalProjects: 0, activeProjects: 0, completedProjects: 0, pausedProjects: 0,
          totalDocuments: 0, totalRules: 0, completedRules: 0, pendingRules: 0,
          projectsByPriority: { alta: 0, media: 0, baja: 0 }
        }
      });
      const serialized = JSON.stringify(res.json.mock.calls);
      expect(serialized).not.toContain('$in');
    });

    test('returns the full shape with zeroes when the visible projects have no documents', async () => {
      Document.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
      const res = mockRes();

      await getStats({ query: {}, user: READER }, res);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: {
          totalProjects: 0, activeProjects: 0, completedProjects: 0, pausedProjects: 0,
          totalDocuments: 0, totalRules: 0, completedRules: 0, pendingRules: 0,
          projectsByPriority: { alta: 0, media: 0, baja: 0 }
        }
      });
      expect(Rule.countDocuments).not.toHaveBeenCalled();
    });

    test('treats a user with no permissions like a reader', async () => {
      Project.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
      const res = mockRes();

      await getStats({ query: {}, user: { _id: 'plain', permissions: [] } }, res);

      expect(Project.find).toHaveBeenCalledWith({ participants: 'plain' }, '_id');
    });
  });
});

// Feature 113 (AC7): getAlerts hereda el filtro en su unico Project.find de entrada.
describe('getAlerts authorization scope', () => {
  const WRITER = { _id: 'writer-1', permissions: ['project:write', 'project:read'] };
  const READER = { _id: 'reader-1', permissions: ['project:read'] };

  function mockNothing() {
    Project.find.mockResolvedValue([]);
    Document.find.mockResolvedValue([]);
    Rule.find.mockResolvedValue([]);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockNothing();
  });

  test('scopes the entry Project.find by participation for a reader', async () => {
    await getAlerts({ query: {}, user: READER }, mockRes());

    expect(Project.find).toHaveBeenCalledWith({
      status: { $ne: 'unavailable' }, participants: READER._id
    });
  });

  test('keeps the current literal filter for a writer', async () => {
    await getAlerts({ query: {}, user: WRITER }, mockRes());

    expect(Project.find).toHaveBeenCalledWith({ status: { $ne: 'unavailable' } });
  });

  test('does not leak the name of a project the reader cannot see', async () => {
    // El recorte en cascada tiene que cubrir los tres niveles: una alerta de regla es la que lleva
    // projectName, que es la fuga que motiva la feature.
    Project.find.mockResolvedValue([
      { _id: 'p-mine', name: 'Mine', status: 'active', deadline: new Date(Date.now() + 86400000) }
    ]);
    Document.find.mockResolvedValue([{ _id: 'd1', name: 'Doc', projectId: 'p-mine' }]);
    Rule.find.mockResolvedValue([
      { _id: 'r1', name: 'Regla ajena', documentId: 'd1', deadline: new Date(Date.now() - 86400000), required: true }
    ]);
    const res = mockRes();

    await getAlerts({ query: {}, user: READER }, res);

    expect(Project.find).toHaveBeenCalledWith({
      status: { $ne: 'unavailable' }, participants: READER._id
    });
    expect(Document.find).toHaveBeenCalledWith({ projectId: 'p-mine' });
    const payload = JSON.stringify(res.json.mock.calls);
    expect(payload).toContain('Mine');
    expect(payload).not.toContain('otro proyecto');
  });

  test('still honours the days parameter unchanged', async () => {
    await getAlerts({ query: { days: '30' }, user: READER }, mockRes());

    expect(Project.find).toHaveBeenCalledWith({
      status: { $ne: 'unavailable' }, participants: READER._id
    });
  });

  test('returns an upcoming rule alert from a visible project, with its projectName', async () => {
    const soon = new Date(Date.now() + 2 * 86400000);
    Project.find.mockResolvedValue([
      { _id: 'p-mine', name: 'Mine', status: 'active', deadline: new Date(Date.now() + 30 * 86400000) }
    ]);
    // El documento lleva deadline lejos para que no genere su propia alerta: lo que se
// prueba aqui es la cascada que deja pasar la alerta de regla del proyecto visible.
Document.find.mockResolvedValue([
      { _id: 'd1', name: 'Doc', projectId: 'p-mine', deadline: new Date(Date.now() + 60 * 86400000) }
    ]);
    Rule.find.mockResolvedValue([{ _id: 'r1', name: 'Regla propia', documentId: 'd1', deadline: soon, required: false }]);
    const res = mockRes();

    await getAlerts({ query: {}, user: READER }, res);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: {
        overdue: [],
        upcoming: [
          {
            type: 'rule', id: 'r1', name: 'Regla propia', projectName: 'Mine',
            deadline: soon, daysUntilDeadline: 2
          }
        ]
      }
    });
  });

  test('returns 500 on unexpected error', async () => {
    Project.find.mockRejectedValue(new Error('DB down'));
    const res = mockRes();

    await getAlerts({ query: {}, user: READER }, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'INTERNAL_ERROR', message: 'DB down' } });
  });
});
