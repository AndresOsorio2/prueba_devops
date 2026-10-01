jest.mock('../../src/models/Document', () => require('../mocks/mongooseModel')());
jest.mock('../../src/models/Rule', () => require('../mocks/mongooseModel')());
jest.mock('../../src/models/Evidence', () => require('../mocks/mongooseModel')());
jest.mock('../../src/services/ai/azureOpenAiClient');
jest.mock('../../src/services/eventSourcingService', () => ({
  createEvent: jest.fn().mockResolvedValue({})
}));
jest.mock('fs');

const fs = require('fs');
const Document = require('../../src/models/Document');
const Rule = require('../../src/models/Rule');
const Evidence = require('../../src/models/Evidence');
const azureOpenAiClient = require('../../src/services/ai/azureOpenAiClient');
const { createEvent } = require('../../src/services/eventSourcingService');
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

const evidence = (overrides) => ({
  ruleId: overrides.ruleId,
  type: overrides.type,
  value: overrides.value,
  originalName: overrides.originalName,
  mimeType: overrides.mimeType,
  toObject: () => ({ ...overrides })
});

beforeEach(() => {
  jest.clearAllMocks();
  azureOpenAiClient.getAzureConfig.mockReturnValue({ apiKey: 'k', apiUrl: 'https://azure.example/chat' });
});

describe('generateDocumentSection', () => {
  test('throws NOT_FOUND when document does not exist', async () => {
    Document.findById.mockResolvedValue(null);

    await expect(generateDocumentSection('missing')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  test('throws NO_CONTENT when the document has no rules', async () => {
    Document.findById.mockResolvedValue({ _id: 'doc1', name: 'Doc 1' });
    Rule.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([]) });

    await expect(generateDocumentSection('doc1')).rejects.toMatchObject({ code: 'NO_CONTENT' });
    expect(azureOpenAiClient.generateRuleSectionMarkdown).not.toHaveBeenCalled();
  });

  test('throws AI_CONFIG_MISSING before doing any work when credentials are missing', async () => {
    Document.findById.mockResolvedValue({ _id: 'doc1', name: 'Doc 1' });
    Rule.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([rule({ id: 'r1', name: 'Regla 1' })]) });
    const configError = new Error('Faltan credenciales');
    configError.code = 'AI_CONFIG_MISSING';
    azureOpenAiClient.getAzureConfig.mockImplementation(() => { throw configError; });

    await expect(generateDocumentSection('doc1')).rejects.toMatchObject({ code: 'AI_CONFIG_MISSING' });
    expect(azureOpenAiClient.generateRuleSectionMarkdown).not.toHaveBeenCalled();
  });

  test('generates markdown for a document with a simple rule tree', async () => {
    Document.findById.mockResolvedValue({ _id: 'doc1', name: 'Doc 1', description: 'Descripción del doc', projectId: 'p1' });
    Rule.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([rule({ id: 'r1', name: 'Regla 1' })]) });
    Evidence.find.mockResolvedValue([]);
    azureOpenAiClient.generateRuleSectionMarkdown.mockResolvedValue({ markdown: '## Regla 1\n\nContenido generado.', truncated: false });

    const result = await generateDocumentSection('doc1');

    expect(result.markdown).toContain('# Doc 1');
    expect(result.markdown).toContain('Descripción del doc');
    expect(result.markdown).toContain('## Tabla de Contenido');
    expect(result.markdown).toContain('## Regla 1');
    expect(result.warnings).toEqual([]);
    expect(createEvent).toHaveBeenCalledWith(
      'ai_report_generated',
      { warnings: 0 },
      { projectId: 'p1', documentId: 'doc1' }
    );
  });

  test('prioritizes text/markdown evidence over file/url when building the prompt payload', async () => {
    Document.findById.mockResolvedValue({ _id: 'doc1', name: 'Doc 1', projectId: 'p1' });
    Rule.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([rule({ id: 'r1', name: 'Regla 1' })]) });
    Evidence.find.mockResolvedValue([
      evidence({ ruleId: 'r1', type: 'file', value: 'uploads/r1/a.pdf', originalName: 'a.pdf', mimeType: 'application/pdf' }),
      evidence({ ruleId: 'r1', type: 'url', value: 'https://example.com' }),
      evidence({ ruleId: 'r1', type: 'text', value: 'Texto autoritativo' })
    ]);
    azureOpenAiClient.generateRuleSectionMarkdown.mockResolvedValue({ markdown: '## Regla 1', truncated: false });

    await generateDocumentSection('doc1');

    const [, sentRule] = azureOpenAiClient.generateRuleSectionMarkdown.mock.calls[0];
    expect(sentRule.evidences.map((e) => e.type)).toEqual(['text', 'url', 'file']);
  });

  test('analyzes image evidence with vision and attaches the result', async () => {
    Document.findById.mockResolvedValue({ _id: 'doc1', name: 'Doc 1', projectId: 'p1' });
    Rule.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([rule({ id: 'r1', name: 'Regla 1' })]) });
    Evidence.find.mockResolvedValue([
      evidence({ ruleId: 'r1', type: 'file', value: 'uploads/r1/diagram.png', originalName: 'diagram.png', mimeType: 'image/png' })
    ]);
    fs.readFileSync.mockReturnValue(Buffer.from('fake-image'));
    azureOpenAiClient.analyzeImageEvidence.mockResolvedValue({ isDiagram: true, description: 'Un diagrama', mermaid: 'flowchart TD\nA-->B' });
    azureOpenAiClient.generateRuleSectionMarkdown.mockImplementation(async (document, sentRule) => {
      expect(sentRule.evidences[0].imageAnalysis).toBe('Un diagrama');
      expect(sentRule.evidences[0].imageMermaid).toBe('flowchart TD\nA-->B');
      return { markdown: '## Regla 1', truncated: false };
    });

    await generateDocumentSection('doc1');

    expect(azureOpenAiClient.analyzeImageEvidence).toHaveBeenCalledTimes(1);
  });

  test('continues and returns a warning when a section fails to generate', async () => {
    Document.findById.mockResolvedValue({ _id: 'doc1', name: 'Doc 1', projectId: 'p1' });
    Rule.find.mockReturnValue({
      sort: jest.fn().mockResolvedValue([rule({ id: 'r1', name: 'Regla 1' }), rule({ id: 'r2', name: 'Regla 2' })])
    });
    Evidence.find.mockResolvedValue([]);
    azureOpenAiClient.generateRuleSectionMarkdown
      .mockRejectedValueOnce(Object.assign(new Error('Azure OpenAI respondió 502'), { code: 'AI_PROVIDER_ERROR' }))
      .mockResolvedValueOnce({ markdown: '## Regla 2', truncated: false });

    const result = await generateDocumentSection('doc1');

    expect(result.markdown).toContain('⚠️ No se pudo generar la sección "Regla 1"');
    expect(result.markdown).toContain('## Regla 2');
    expect(result.warnings).toHaveLength(1);
  });

  test('adds a warning when a section is truncated by Azure', async () => {
    Document.findById.mockResolvedValue({ _id: 'doc1', name: 'Doc 1', projectId: 'p1' });
    Rule.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([rule({ id: 'r1', name: 'Regla 1' })]) });
    Evidence.find.mockResolvedValue([]);
    azureOpenAiClient.generateRuleSectionMarkdown.mockResolvedValue({ markdown: '## Regla 1', truncated: true });

    const result = await generateDocumentSection('doc1');

    expect(result.warnings).toEqual(['La sección "Regla 1" se truncó por límite de tokens de Azure OpenAI']);
  });

  test('passes optional instructions through to the Azure client', async () => {
    Document.findById.mockResolvedValue({ _id: 'doc1', name: 'Doc 1', projectId: 'p1' });
    Rule.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([rule({ id: 'r1', name: 'Regla 1' })]) });
    Evidence.find.mockResolvedValue([]);
    azureOpenAiClient.generateRuleSectionMarkdown.mockResolvedValue({ markdown: '## Regla 1', truncated: false });

    await generateDocumentSection('doc1', { instructions: 'Enfócate en riesgos' });

    expect(azureOpenAiClient.generateRuleSectionMarkdown).toHaveBeenCalledWith(
      expect.objectContaining({ _id: 'doc1' }),
      expect.objectContaining({ name: 'Regla 1' }),
      'Enfócate en riesgos'
    );
  });
});
