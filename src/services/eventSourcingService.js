const Event = require('../models/Event');
const { parseOffsetLimit } = require('../utils/pagination');
const logger = require('../logger/seqLogger');

const createEvent = async (eventType, payload, context = {}) => {
  try {
    const event = new Event({
      projectId: context.projectId,
      documentId: context.documentId || null,
      ruleId: context.ruleId || null,
      eventType,
      payload,
      timestamp: new Date()
    });

    await event.save();
    logger.info(`🔵 Event created: ${eventType}`, { eventId: event._id, eventType, payload });
    return event;
  } catch (error) {
    logger.error('🔴 Error creating event', { error: error.message, eventType });
    throw error;
  }
};

const getProjectEvents = async (projectId, options = {}) => {
  const { limit, offset } = parseOffsetLimit(options);
  const { eventType } = options;

  const query = { projectId };
  if (eventType) query.eventType = eventType;

  return Event.find(query)
    .sort({ timestamp: -1 })
    .skip(offset)
    .limit(limit);
};

// Definiciones de milestone: cada uno matchea uno o mas eventType reales,
// opcionalmente filtrados por el payload del evento (ver payload.newStatus).
const MILESTONE_DEFINITIONS = [
  { id: 'project_created', label: 'Creación del Proyecto', eventTypes: ['project_created'] },
  { id: 'rules_defined', label: 'Reglas Definidas', eventTypes: ['rule_created'] },
  { id: 'evidence_uploaded', label: 'Evidencias Cargadas', eventTypes: ['evidence_added'] },
  { id: 'report_generated', label: 'Reporte Generado', eventTypes: ['report_generated', 'report_edited'] },
  {
    id: 'project_completed',
    label: 'Proyecto Completado',
    eventTypes: ['project_status_changed'],
    matchPayload: (payload) => payload?.newStatus === 'done'
  }
];

const getProjectTimeline = async (projectId) => {
  const events = await Event.find({ projectId })
    .sort({ timestamp: 1 });

  const milestones = MILESTONE_DEFINITIONS.map(({ id, label }) => ({ id, label, status: 'pending', date: null }));

  events.forEach(event => {
    const definition = MILESTONE_DEFINITIONS.find(m =>
      m.eventTypes.includes(event.eventType) && (!m.matchPayload || m.matchPayload(event.payload))
    );
    if (!definition) return;

    const milestone = milestones.find(m => m.id === definition.id);
    milestone.status = 'completed';
    milestone.date = event.timestamp;
  });

  return { milestones };
};

module.exports = { createEvent, getProjectEvents, getProjectTimeline };
