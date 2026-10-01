jest.mock('../../src/models/Project', () => require('../mocks/mongooseModel')());
jest.mock('../../src/models/Document', () => require('../mocks/mongooseModel')());
jest.mock('../../src/models/Rule', () => require('../mocks/mongooseModel')());
jest.mock('../../src/services/eventSourcingService', () => ({
  getProjectEvents: jest.fn(),
  getProjectTimeline: jest.fn()
}));

const Project = require('../../src/models/Project');
const { getProjectEvents, getProjectTimeline } = require('../../src/services/eventSourcingService');
const { getEvents, getTimeline } = require('../../src/controllers/eventController');

const WRITER = { _id: 'u1', permissions: ['project:write'] };
const PARTICIPANT = { _id: 'u2', permissions: [] };
const OUTSIDER = { _id: 'u3', permissions: ['project:read'] };

// Inyecta el usuario autenticado en el req, como lo hace `authenticate`.
const authReq = (req, user = PARTICIPANT) => ({ user, ...req });

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

beforeEach(() => {
  jest.clearAllMocks();
  Project.findById.mockResolvedValue({ _id: 'p1', participants: [PARTICIPANT._id] });
});

describe('eventController', () => {
  describe('getEvents', () => {
    test('returns 404 when project does not exist', async () => {
      Project.findById.mockResolvedValue(null);
      const req = authReq({ params: { id: 'p1' }, query: {} });
      const res = mockRes();

      await getEvents(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'NOT_FOUND', message: 'Project not found' } });
    });

    test('returns events with default pagination', async () => {
      Project.findById.mockResolvedValue({ _id: 'p1', participants: [PARTICIPANT._id] });
      const events = [{ _id: 'e1', eventType: 'project_created' }];
      getProjectEvents.mockResolvedValue(events);
      const req = authReq({ params: { id: 'p1' }, query: {} });
      const res = mockRes();

      await getEvents(req, res);

      expect(getProjectEvents).toHaveBeenCalledWith('p1', { limit: 50, offset: 0, eventType: undefined });
      expect(res.json).toHaveBeenCalledWith({ success: true, data: events });
    });

    test('passes limit, offset and eventType filters', async () => {
      Project.findById.mockResolvedValue({ _id: 'p1', participants: [PARTICIPANT._id] });
      getProjectEvents.mockResolvedValue([]);
      const req = authReq({ params: { id: 'p1' }, query: { limit: '10', offset: '5', eventType: 'rule_created' } });
      const res = mockRes();

      await getEvents(req, res);

      expect(getProjectEvents).toHaveBeenCalledWith('p1', { limit: 10, offset: 5, eventType: 'rule_created' });
      expect(res.json).toHaveBeenCalledWith({ success: true, data: [] });
    });

    test('returns 500 on unexpected error', async () => {
      Project.findById.mockRejectedValue(new Error('DB down'));
      const req = authReq({ params: { id: 'p1' }, query: {} });
      const res = mockRes();

      await getEvents(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'INTERNAL_ERROR', message: 'DB down' } });
    });

    test('returns 403 when the user does not participate in the project', async () => {
      Project.findById.mockResolvedValue({ _id: 'p1', participants: ['someone-else'] });
      const req = authReq({ params: { id: 'p1' }, query: {} }, OUTSIDER);
      const res = mockRes();

      await getEvents(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'FORBIDDEN', message: 'No eres participante del proyecto' } });
      expect(getProjectEvents).not.toHaveBeenCalled();
    });

    test('returns 403 when the user has no permissions and does not participate', async () => {
      Project.findById.mockResolvedValue({ _id: 'p1', participants: ['someone-else'] });
      const nobody = { _id: 'u9', permissions: [] };
      const req = authReq({ params: { id: 'p1' }, query: {} }, nobody);
      const res = mockRes();

      await getEvents(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
    });

    test('project:read alone does not grant access to a foreign project history', async () => {
      Project.findById.mockResolvedValue({ _id: 'p1', participants: ['someone-else'] });
      const req = authReq({ params: { id: 'p1' }, query: {} }, OUTSIDER);
      const res = mockRes();

      await getEvents(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
    });

    test('returns events for a project:write user without being a participant', async () => {
      Project.findById.mockResolvedValue({ _id: 'p1', participants: [] });
      getProjectEvents.mockResolvedValue([]);
      const req = authReq({ params: { id: 'p1' }, query: {} }, WRITER);
      const res = mockRes();

      await getEvents(req, res);

      expect(getProjectEvents).toHaveBeenCalledWith('p1', { limit: 50, offset: 0, eventType: undefined });
      expect(res.json).toHaveBeenCalledWith({ success: true, data: [] });
    });
  });

  describe('getTimeline', () => {
    test('returns 404 when project does not exist', async () => {
      Project.findById.mockResolvedValue(null);
      const req = authReq({ params: { id: 'p1' } });
      const res = mockRes();

      await getTimeline(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'NOT_FOUND', message: 'Project not found' } });
    });

    test('returns timeline milestones', async () => {
      Project.findById.mockResolvedValue({ _id: 'p1', participants: [PARTICIPANT._id] });
      const timeline = { milestones: [{ id: 'project_created', status: 'completed' }] };
      getProjectTimeline.mockResolvedValue(timeline);
      const req = authReq({ params: { id: 'p1' } });
      const res = mockRes();

      await getTimeline(req, res);

      expect(getProjectTimeline).toHaveBeenCalledWith('p1');
      expect(res.json).toHaveBeenCalledWith({ success: true, data: timeline });
    });

    test('returns 500 on unexpected error', async () => {
      Project.findById.mockRejectedValue(new Error('DB down'));
      const req = authReq({ params: { id: 'p1' } });
      const res = mockRes();

      await getTimeline(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'INTERNAL_ERROR', message: 'DB down' } });
    });

    test('returns 403 when the user does not participate in the project', async () => {
      Project.findById.mockResolvedValue({ _id: 'p1', participants: ['someone-else'] });
      const req = authReq({ params: { id: 'p1' } }, OUTSIDER);
      const res = mockRes();

      await getTimeline(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'FORBIDDEN', message: 'No eres participante del proyecto' } });
      expect(getProjectTimeline).not.toHaveBeenCalled();
    });

    test('project:read alone does not grant access to a foreign timeline', async () => {
      Project.findById.mockResolvedValue({ _id: 'p1', participants: ['someone-else'] });
      const req = authReq({ params: { id: 'p1' } }, OUTSIDER);
      const res = mockRes();

      await getTimeline(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
    });

    test('returns timeline for a project:write user without being a participant', async () => {
      Project.findById.mockResolvedValue({ _id: 'p1', participants: [] });
      getProjectTimeline.mockResolvedValue({ milestones: [] });
      const req = authReq({ params: { id: 'p1' } }, WRITER);
      const res = mockRes();

      await getTimeline(req, res);

      expect(getProjectTimeline).toHaveBeenCalledWith('p1');
      expect(res.json).toHaveBeenCalledWith({ success: true, data: { milestones: [] } });
    });
  });
});
