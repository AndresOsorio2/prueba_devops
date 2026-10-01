jest.mock('../../src/models/Event', () => require('../mocks/mongooseModel')());

const Event = require('../../src/models/Event');
const { getProjectTimeline } = require('../../src/services/eventSourcingService');

function mockEvents(events) {
  Event.find.mockReturnValue({ sort: jest.fn().mockResolvedValue(events) });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getProjectTimeline', () => {
  test('all milestones stay pending when there are no events', async () => {
    mockEvents([]);

    const { milestones } = await getProjectTimeline('p1');

    expect(milestones).toEqual([
      { id: 'project_created', label: 'Creación del Proyecto', status: 'pending', date: null },
      { id: 'rules_defined', label: 'Reglas Definidas', status: 'pending', date: null },
      { id: 'evidence_uploaded', label: 'Evidencias Cargadas', status: 'pending', date: null },
      { id: 'report_generated', label: 'Reporte Generado', status: 'pending', date: null },
      { id: 'project_completed', label: 'Proyecto Completado', status: 'pending', date: null }
    ]);
  });

  test('project_created event completes the project_created milestone', async () => {
    const date = new Date('2026-08-19T10:00:00Z');
    mockEvents([{ eventType: 'project_created', payload: {}, timestamp: date }]);

    const { milestones } = await getProjectTimeline('p1');

    expect(milestones.find(m => m.id === 'project_created')).toEqual({
      id: 'project_created', label: 'Creación del Proyecto', status: 'completed', date
    });
  });

  test('rule_created event completes the rules_defined milestone', async () => {
    const date = new Date('2026-08-20T10:00:00Z');
    mockEvents([{ eventType: 'rule_created', payload: {}, timestamp: date }]);

    const { milestones } = await getProjectTimeline('p1');

    expect(milestones.find(m => m.id === 'rules_defined').status).toBe('completed');
  });

  test('evidence_added event completes the evidence_uploaded milestone', async () => {
    const date = new Date('2026-08-21T10:00:00Z');
    mockEvents([{ eventType: 'evidence_added', payload: {}, timestamp: date }]);

    const { milestones } = await getProjectTimeline('p1');

    expect(milestones.find(m => m.id === 'evidence_uploaded').status).toBe('completed');
  });

  test.each(['report_generated', 'report_edited'])(
    '%s event completes the report_generated milestone',
    async (eventType) => {
      const date = new Date('2026-08-22T10:00:00Z');
      mockEvents([{ eventType, payload: {}, timestamp: date }]);

      const { milestones } = await getProjectTimeline('p1');

      expect(milestones.find(m => m.id === 'report_generated').status).toBe('completed');
    }
  );

  test('project_status_changed with newStatus done completes project_completed milestone', async () => {
    const date = new Date('2026-08-23T10:00:00Z');
    mockEvents([{ eventType: 'project_status_changed', payload: { newStatus: 'done' }, timestamp: date }]);

    const { milestones } = await getProjectTimeline('p1');

    expect(milestones.find(m => m.id === 'project_completed')).toEqual({
      id: 'project_completed', label: 'Proyecto Completado', status: 'completed', date
    });
  });

  test.each(['paused', 'active', 'unavailable'])(
    'project_status_changed with newStatus %s does NOT complete project_completed milestone',
    async (newStatus) => {
      mockEvents([{ eventType: 'project_status_changed', payload: { newStatus }, timestamp: new Date() }]);

      const { milestones } = await getProjectTimeline('p1');

      expect(milestones.find(m => m.id === 'project_completed').status).toBe('pending');
    }
  );

  test('events without a matching milestone are ignored', async () => {
    mockEvents([{ eventType: 'document_updated', payload: {}, timestamp: new Date() }]);

    const { milestones } = await getProjectTimeline('p1');

    expect(milestones.every(m => m.status === 'pending')).toBe(true);
  });

  test('uses the timestamp of the last matching event in chronological order', async () => {
    const firstRule = new Date('2026-08-20T10:00:00Z');
    const secondRule = new Date('2026-08-25T10:00:00Z');
    mockEvents([
      { eventType: 'rule_created', payload: {}, timestamp: firstRule },
      { eventType: 'rule_created', payload: {}, timestamp: secondRule }
    ]);

    const { milestones } = await getProjectTimeline('p1');

    expect(milestones.find(m => m.id === 'rules_defined').date).toEqual(secondRule);
  });

  test('does not include a project_review milestone', async () => {
    mockEvents([]);

    const { milestones } = await getProjectTimeline('p1');

    expect(milestones.find(m => m.id === 'project_review')).toBeUndefined();
  });
});
