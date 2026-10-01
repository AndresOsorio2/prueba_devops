const config = require('../../config');
const { RULE_SECTION_SYSTEM_PROMPT, VISION_SYSTEM_PROMPT } = require('./prompts');

// Extrae el primer objeto JSON de la respuesta (por si el modelo lo envuelve en ```json u otro texto)
function extractJsonObject(text) {
  const withoutFences = text.replace(/```json|```/gi, '').trim();
  const match = withoutFences.match(/\{[\s\S]*\}/);
  return match ? match[0] : withoutFences;
}

// D-104: la resolucion de credenciales vive en config y se sigue invocando aqui, en el
// punto de uso, para que docker-compose (que no pasa estas variables) no rompa el arranque.
const getAzureConfig = () => config.azureOpenAI.require();

// Timeout maximo para la generacion de reportes con IA (solo esta transaccion).
const getAzureTimeoutMs = () => config.azureOpenAI.timeoutMs;

// Detecta un abort provocado por AbortSignal.timeout (Node >= 17.3 lanza TimeoutError).
const isTimeoutAbort = (err) =>
  err?.name === 'TimeoutError' ||
  err?.name === 'AbortError' ||
  err?.cause?.name === 'TimeoutError' ||
  err?.cause?.name === 'AbortError';

const timeoutError = () => {
  const minutes = getAzureTimeoutMs() / 60000;
  const error = new Error(`Azure OpenAI no respondió en ${minutes} minutos (timeout)`);
  error.code = 'AI_PROVIDER_ERROR';
  return error;
};

const callAzureChatCompletion = async (requestBody, statusHints = {}) => {
  const { apiKey, apiUrl } = getAzureConfig();

  let res;
  try {
    res = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(getAzureTimeoutMs())
    });
  } catch (err) {
    if (isTimeoutAbort(err)) throw timeoutError();
    const error = new Error('No se pudo contactar a Azure OpenAI');
    error.code = 'AI_PROVIDER_ERROR';
    error.cause = err;
    throw error;
  }

  const rawText = await res.text();
  let rawResponse;
  try {
    rawResponse = JSON.parse(rawText);
  } catch {
    rawResponse = rawText;
  }

  if (!res.ok) {
    const hint = statusHints[res.status] || '';
    const error = new Error(`Azure OpenAI respondió ${res.status}${hint}`);
    error.code = 'AI_PROVIDER_ERROR';
    error.rawResponse = rawResponse;
    throw error;
  }

  const content = rawResponse?.choices?.[0]?.message?.content;
  if (!content) {
    const error = new Error('Azure OpenAI no devolvió contenido en la respuesta');
    error.code = 'AI_PROVIDER_ERROR';
    throw error;
  }

  const truncated = rawResponse.choices[0].finish_reason === 'length';
  return { markdown: content.trim(), truncated };
};

// El modelo/deployment ya queda fijado en la URL de Azure; no se envía "model" en el body.
const generateRuleSectionMarkdown = async (document, rule, instructions) => {
  const userPayload = { document: { name: document.name, description: document.description }, rule };
  if (instructions && String(instructions).trim()) {
    userPayload.instructions = String(instructions).trim();
  }

  const requestBody = {
    temperature: 0.2,
    max_tokens: 8192,
    messages: [
      { role: 'system', content: RULE_SECTION_SYSTEM_PROMPT },
      { role: 'user', content: JSON.stringify(userPayload, null, 2) }
    ]
  };

  return callAzureChatCompletion(requestBody, {
    413: ` (payload demasiado grande incluso para una sola regla: "${rule.name}" tiene demasiadas evidencias/imágenes)`
  });
};

const analyzeImageEvidence = async (dataUrl, context) => {
  const { apiKey, apiUrl } = getAzureConfig();

  let res;
  try {
    res = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
      body: JSON.stringify({
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: VISION_SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'text', text: context || 'Analiza esta imagen y describe su contenido relevante como evidencia.' },
              { type: 'image_url', image_url: { url: dataUrl } }
            ]
          }
        ]
      }),
      signal: AbortSignal.timeout(getAzureTimeoutMs())
    });
  } catch (err) {
    if (isTimeoutAbort(err)) throw timeoutError();
    const error = new Error('No se pudo contactar a Azure OpenAI (vision)');
    error.code = 'AI_PROVIDER_ERROR';
    error.cause = err;
    throw error;
  }

  const rawText = await res.text();
  let rawResponse;
  try {
    rawResponse = JSON.parse(rawText);
  } catch {
    rawResponse = rawText;
  }

  if (!res.ok) {
    const hint = res.status === 413 ? ' (imagen demasiado pesada)' : '';
    const error = new Error(`Azure OpenAI (vision) respondió ${res.status}${hint}`);
    error.code = 'AI_PROVIDER_ERROR';
    error.rawResponse = rawResponse;
    throw error;
  }

  const content = rawResponse?.choices?.[0]?.message?.content;
  if (!content) {
    const error = new Error('Azure OpenAI no devolvió contenido para la imagen');
    error.code = 'AI_PROVIDER_ERROR';
    throw error;
  }

  try {
    const parsed = JSON.parse(extractJsonObject(content));
    return {
      isDiagram: Boolean(parsed.isDiagram),
      description: parsed.description || content,
      mermaid: parsed.isDiagram ? parsed.mermaid || null : null
    };
  } catch {
    // Si el modelo no devolvió JSON válido, se conserva el texto crudo como descripción
    return { isDiagram: false, description: content, mermaid: null };
  }
};

module.exports = { getAzureConfig, getAzureTimeoutMs, generateRuleSectionMarkdown, analyzeImageEvidence };
