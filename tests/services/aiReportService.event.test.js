jest.mock('../../src/models/Document', () => require('../mocks/mongooseModel')());
jest.mock('../../src/models/Rule', () => require('../mocks/mongooseModel')());
jest.mock('../../src/models/Evidence', () => require('../mocks/mongooseModel')());
jest.mock('../../src/models/Event', () => require('../mocks/mongooseModel')());
jest.mock('../../src/services/ai/azureOpenAiClient');
jest.mock('../../src/logger/seqLogger', () => ({ info: jest.fn(), error: jest.fn() }));
jest.mock('fs');

const Event = require('../../src/models/Event');
const Document = require('../../src/models/Document');
const Rule = require('../../src/models/Rule');
const Evidence = require('../../src/models/Evidence');
const azureOpenAiClient = require('../../src/services/ai/azureOpenAiClient');
const logger = require('../../src/logger/seqLogger');
const { generateDocumentSection } = require('../../src/services/aiReportService');

const rule = (overrides) => ({
  _id: overrides.id,
  documentId: 'doc1',
  parentId: overrides.parentId || null,
  name: overrides.name,
  description: overrides.description || '',
  type: overrides.type || 'text',
  order: overrides.order || 0,
  markdownContent: overrides.markdownContent || '',
  toObject: undefined
});

function mockGeneration({ ruleNames = ['Regla 1'] } = {}) {
  Document.findById.mockResolvedValue({ _id: 'doc1', name: 'Doc 1', description: 'Descripción del doc', projectId: 'p1' });
  Rule.find.mockReturnValue({ sort: jest.fn().mockResolvedValue(ruleNames.map((name, i) => rule({ id: `r${i + 1}`, name }))) });
  Evidence.find.mockResolvedValue([]);
  azureOpenAiClient.generateRuleSectionMarkdown.mockResolvedValue({ markdown: '## Contenido generado.', truncated: false });
}

beforeEach(() => {
  jest.clearAllMocks();
  azureOpenAiClient.getAzureConfig.mockReturnValue({ apiKey: 'k', apiUrl: 'https://azure.example/chat' });
});

describe('generateDocumentSection event persistence', () => {
  test('persists an ai_report_generated event through the real eventSourcingService', async () => {
    mockGeneration();

    const result = await generateDocumentSection('doc1');

    const saved = Event.mock.instances.find((instance) => instance.eventType === 'ai_report_generated');
    expect(saved).toBeDefined();
    expect(saved.projectId).toBe('p1');
    expect(saved.documentId).toBe('doc1');
    expect(saved.payload).toEqual({ warnings: 0 });
    expect(saved.save).toHaveBeenCalled();

    expect(result.markdown).toContain('# Doc 1');
    expect(result.generatedAt).toBeInstanceOf(Date);
    expect(result.warnings).toEqual([]);
    expect(logger.error).not.toHaveBeenCalled();
  });

  test('does not persist a report when the generation itself fails', async () => {
    Document.findById.mockResolvedValue({ _id: 'doc1', name: 'Doc 1', projectId: 'p1' });
    Rule.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([rule({ id: 'r1', name: 'Regla 1' })]) });
    azureOpenAiClient.getAzureConfig.mockImplementation(() => {
      const error = new Error('Faltan credenciales');
      error.code = 'AI_CONFIG_MISSING';
      throw error;
    });

    await expect(generateDocumentSection('doc1')).rejects.toMatchObject({ code: 'AI_CONFIG_MISSING' });

    expect(Event.mock.instances).toHaveLength(0);
  });

  test('keeps responding and logs the error when the event save fails', async () => {
    mockGeneration();
    const defaultImpl = Event.getMockImplementation();
    Event.mockImplementation(function (data) {
      Object.assign(this, data);
      this.save = jest.fn().mockRejectedValue(new Error('DB down'));
      return this;
    });

    try {
      const result = await generateDocumentSection('doc1');

      expect(result.markdown).toContain('# Doc 1');
      expect(result.warnings).toEqual([]);
      expect(logger.error).toHaveBeenCalledWith('🔴 Error creating event', { error: 'DB down', eventType: 'ai_report_generated' });
      expect(logger.error).toHaveBeenCalledWith('🔴 Error creating ai_report_generated event', { error: 'DB down' });
    } finally {
      Event.mockImplementation(defaultImpl);
    }
  });
});