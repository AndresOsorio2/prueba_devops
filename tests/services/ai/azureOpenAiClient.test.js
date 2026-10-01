const ORIGINAL_ENV = process.env;

const setAzureEnv = () => {
  process.env.AZURE_OPENAI_API_KEY = 'test-key';
  process.env.AZURE_OPENAI_ENDPOINT = 'https://example.openai.azure.com/';
  process.env.AZURE_OPENAI_DEPLOYMENT = 'gpt-4.1';
  process.env.AZURE_OPENAI_API_VERSION = '2024-10-21';
};

beforeEach(() => {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV };
  delete process.env.AZURE_OPENAI_API_KEY;
  delete process.env.AZURE_OPENAI_ENDPOINT;
  delete process.env.AZURE_OPENAI_DEPLOYMENT;
  delete process.env.AZURE_OPENAI_API_VERSION;
  global.fetch = jest.fn();
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe('getAzureConfig', () => {
  test('throws AI_CONFIG_MISSING when credentials are missing', () => {
    const { getAzureConfig } = require('../../../src/services/ai/azureOpenAiClient');
    expect(() => getAzureConfig()).toThrow(expect.objectContaining({ code: 'AI_CONFIG_MISSING' }));
  });

  test('builds the chat completions URL from endpoint/deployment/apiVersion', () => {
    setAzureEnv();
    const { getAzureConfig } = require('../../../src/services/ai/azureOpenAiClient');
    const config = getAzureConfig();
    expect(config.apiKey).toBe('test-key');
    expect(config.apiUrl).toBe(
      'https://example.openai.azure.com/openai/deployments/gpt-4.1/chat/completions?api-version=2024-10-21'
    );
  });
});

describe('generateRuleSectionMarkdown', () => {
  test('returns trimmed markdown and truncated=false on success', async () => {
    setAzureEnv();
    const { generateRuleSectionMarkdown } = require('../../../src/services/ai/azureOpenAiClient');
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: '  ## Regla  ' }, finish_reason: 'stop' }] })
    });

    const result = await generateRuleSectionMarkdown({ name: 'Doc', description: '' }, { name: 'Regla' });

    expect(result).toEqual({ markdown: '## Regla', truncated: false });
  });

  test('marks truncated=true when finish_reason is length', async () => {
    setAzureEnv();
    const { generateRuleSectionMarkdown } = require('../../../src/services/ai/azureOpenAiClient');
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: 'partial' }, finish_reason: 'length' }] })
    });

    const result = await generateRuleSectionMarkdown({ name: 'Doc' }, { name: 'Regla' });

    expect(result.truncated).toBe(true);
  });

  test('throws AI_PROVIDER_ERROR with hint on non-ok response', async () => {
    setAzureEnv();
    const { generateRuleSectionMarkdown } = require('../../../src/services/ai/azureOpenAiClient');
    global.fetch.mockResolvedValue({ ok: false, status: 413, text: async () => JSON.stringify({ error: 'too big' }) });

    await expect(generateRuleSectionMarkdown({ name: 'Doc' }, { name: 'Regla' })).rejects.toMatchObject({
      code: 'AI_PROVIDER_ERROR'
    });
  });

  test('throws AI_PROVIDER_ERROR when fetch itself fails (network error)', async () => {
    setAzureEnv();
    const { generateRuleSectionMarkdown } = require('../../../src/services/ai/azureOpenAiClient');
    global.fetch.mockRejectedValue(new Error('network down'));

    await expect(generateRuleSectionMarkdown({ name: 'Doc' }, { name: 'Regla' })).rejects.toMatchObject({
      code: 'AI_PROVIDER_ERROR'
    });
  });
});

describe('analyzeImageEvidence', () => {
  test('parses a valid JSON response', async () => {
    setAzureEnv();
    const { analyzeImageEvidence } = require('../../../src/services/ai/azureOpenAiClient');
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        choices: [{ message: { content: '{"isDiagram":true,"description":"Un diagrama","mermaid":"flowchart TD"}' } }]
      })
    });

    const result = await analyzeImageEvidence('data:image/png;base64,abc', 'contexto');

    expect(result).toEqual({ isDiagram: true, description: 'Un diagrama', mermaid: 'flowchart TD' });
  });

  test('falls back to raw text description when the model does not return valid JSON', async () => {
    setAzureEnv();
    const { analyzeImageEvidence } = require('../../../src/services/ai/azureOpenAiClient');
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: 'no es json' } }] })
    });

    const result = await analyzeImageEvidence('data:image/png;base64,abc', 'contexto');

    expect(result).toEqual({ isDiagram: false, description: 'no es json', mermaid: null });
  });

  test('throws AI_PROVIDER_ERROR on non-ok response', async () => {
    setAzureEnv();
    const { analyzeImageEvidence } = require('../../../src/services/ai/azureOpenAiClient');
    global.fetch.mockResolvedValue({ ok: false, status: 413, text: async () => 'too big' });

    await expect(analyzeImageEvidence('data:image/png;base64,abc', 'contexto')).rejects.toMatchObject({
      code: 'AI_PROVIDER_ERROR'
    });
  });
});

describe('timeout (feature 67)', () => {
  test('callAzureChatCompletion usa AbortSignal.timeout con el default de 240000', async () => {
    setAzureEnv();
    delete process.env.AZURE_OPENAI_TIMEOUT_MS;
    const { generateRuleSectionMarkdown } = require('../../../src/services/ai/azureOpenAiClient');
    const timeoutSpy = jest.spyOn(AbortSignal, 'timeout');
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] })
    });

    await generateRuleSectionMarkdown({ name: 'Doc' }, { name: 'Regla' });

    expect(timeoutSpy).toHaveBeenCalledWith(240000);
    expect(global.fetch.mock.calls[0][1]).toHaveProperty('signal');
    timeoutSpy.mockRestore();
  });

  test('callAzureChatCompletion respeta AZURE_OPENAI_TIMEOUT_MS custom', async () => {
    setAzureEnv();
    process.env.AZURE_OPENAI_TIMEOUT_MS = '300000';
    const { generateRuleSectionMarkdown } = require('../../../src/services/ai/azureOpenAiClient');
    const timeoutSpy = jest.spyOn(AbortSignal, 'timeout');
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] })
    });

    await generateRuleSectionMarkdown({ name: 'Doc' }, { name: 'Regla' });

    expect(timeoutSpy).toHaveBeenCalledWith(300000);
    timeoutSpy.mockRestore();
  });

  test('abort por timeout en chat completions se traduce en AI_PROVIDER_ERROR con mensaje claro', async () => {
    setAzureEnv();
    const { generateRuleSectionMarkdown } = require('../../../src/services/ai/azureOpenAiClient');
    global.fetch.mockRejectedValue(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));

    await expect(generateRuleSectionMarkdown({ name: 'Doc' }, { name: 'Regla' })).rejects.toMatchObject({
      code: 'AI_PROVIDER_ERROR',
      message: 'Azure OpenAI no respondió en 4 minutos (timeout)'
    });
  });

  test('analyzeImageEvidence usa AbortSignal.timeout y traduce abort por timeout', async () => {
    setAzureEnv();
    const { analyzeImageEvidence } = require('../../../src/services/ai/azureOpenAiClient');
    const timeoutSpy = jest.spyOn(AbortSignal, 'timeout');

    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        choices: [{ message: { content: '{"isDiagram":false,"description":"ok","mermaid":null}' } }]
      })
    });

    await analyzeImageEvidence('data:image/png;base64,abc', 'contexto');

    expect(timeoutSpy).toHaveBeenCalledWith(240000);
    expect(global.fetch.mock.calls[0][1]).toHaveProperty('signal');
    timeoutSpy.mockRestore();
  });

  test('abort por timeout en vision se traduce en AI_PROVIDER_ERROR con mensaje claro', async () => {
    setAzureEnv();
    const { analyzeImageEvidence } = require('../../../src/services/ai/azureOpenAiClient');
    global.fetch.mockRejectedValue(new TypeError('simulated TimeoutError', { cause: new DOMException('x', 'TimeoutError') }));

    await expect(analyzeImageEvidence('data:image/png;base64,abc', 'contexto')).rejects.toMatchObject({
      code: 'AI_PROVIDER_ERROR',
      message: 'Azure OpenAI no respondió en 4 minutos (timeout)'
    });
  });
});
