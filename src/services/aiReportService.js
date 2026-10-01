const fs = require('fs');
const path = require('path');
const Document = require('../models/Document');
const Rule = require('../models/Rule');
const Evidence = require('../models/Evidence');
const { buildRuleTree, slugify, uniqueSlug, buildTableOfContents } = require('./reportService');
const azureOpenAiClient = require('./ai/azureOpenAiClient');
const { createEvent } = require('./eventSourcingService');
const logger = require('../logger/seqLogger');
const { ERROR_CODES, MESSAGES } = require('../utils/messages');

const IMAGE_EXTENSION_RE = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;
const EVIDENCE_TYPE_PRIORITY = { text: 0, url: 1, file: 2 };

// Convierte un nodo {rule, children} (Mongoose) del arbol de reportService en un objeto plano
// para el prompt, con sus evidencias ordenadas priorizando texto/markdown sobre archivo/url.
const serializeNode = (node, evidencesByRule) => {
  const evidences = (evidencesByRule.get(String(node.rule._id)) || [])
    .map((evidence) => evidence.toObject())
    .sort((a, b) => (EVIDENCE_TYPE_PRIORITY[a.type] ?? 3) - (EVIDENCE_TYPE_PRIORITY[b.type] ?? 3));

  return {
    _id: String(node.rule._id),
    name: node.rule.name,
    description: node.rule.description,
    type: node.rule.type,
    markdownContent: node.rule.markdownContent,
    evidences,
    children: node.children.map((child) => serializeNode(child, evidencesByRule))
  };
};

const collectTocEntries = (nodes, numberPrefix, depth, tocEntries, usedSlugs) => {
  nodes.forEach((node, index) => {
    const number = numberPrefix ? `${numberPrefix}.${index + 1}` : `${index + 1}`;
    const slug = uniqueSlug(slugify(node.name), usedSlugs);
    tocEntries.push({ depth, number, text: node.name, slug });
    collectTocEntries(node.children || [], number, depth + 1, tocEntries, usedSlugs);
  });
};

const isImageEvidence = (evidence) => {
  if (evidence.type !== 'file') return false;
  if (evidence.mimeType && evidence.mimeType.startsWith('image/')) return true;
  return IMAGE_EXTENSION_RE.test(evidence.originalName || evidence.value || '');
};

// Recorre el arbol serializado y devuelve las evidencias tipo archivo que son imagenes,
// junto con su nodo, el nodo padre y sus hermanas (para armar contexto de reglas combinadas).
const collectImageEvidences = (nodes, parentNode, ruleNamePath) => {
  const found = [];
  nodes.forEach((node) => {
    (node.evidences || []).forEach((evidence) => {
      if (isImageEvidence(evidence)) {
        found.push({
          evidence,
          node,
          parentNode,
          siblings: nodes,
          ruleName: ruleNamePath ? `${ruleNamePath} > ${node.name}` : node.name
        });
      }
    });
    found.push(
      ...collectImageEvidences(node.children || [], node, ruleNamePath ? `${ruleNamePath} > ${node.name}` : node.name)
    );
  });
  return found;
};

const buildImageContext = ({ node, parentNode, siblings, ruleName }) => {
  const parts = [`Esta imagen es evidencia de cumplimiento de la regla "${ruleName}".`];

  if (node.description) {
    parts.push(`Descripción de la regla: ${node.description}`);
  }

  if (parentNode) {
    const parentTexts = (parentNode.evidences || []).filter((e) => e.type === 'text').map((e) => e.value);
    const parentContext = [parentNode.description, ...parentTexts].filter(Boolean).join(' ');
    if (parentContext) {
      parts.push(`Contexto de la regla contenedora "${parentNode.name}" (tipo "${parentNode.type}"): ${parentContext}`);
    }

    const textSiblings = siblings.filter((sibling) => sibling._id !== node._id && sibling.type === 'text');
    textSiblings.forEach((sibling) => {
      const siblingTexts = (sibling.evidences || []).filter((e) => e.type === 'text').map((e) => e.value);
      const siblingContext = [sibling.description, ...siblingTexts].filter(Boolean).join(' ');
      if (siblingContext) {
        parts.push(`Contexto de la sub-regla de texto "${sibling.name}" (misma regla contenedora): ${siblingContext}`);
      }
    });
  }

  parts.push(
    'Describe su contenido relevante para esta regla específica. Si identificas un diagrama ' +
      '(arquitectura, flujo, secuencia, entidad-relación, etc.), recréalo también en el campo mermaid.'
  );

  return parts.join('\n\n');
};

const readEvidenceFileAsDataUrl = (evidence) => {
  const filePath = path.resolve(process.cwd(), evidence.value);
  const buffer = fs.readFileSync(filePath);
  return `data:${evidence.mimeType};base64,${buffer.toString('base64')}`;
};

// Analiza (in-place) las evidencias de imagen del arbol serializado con Azure OpenAI Vision,
// adjuntando imageAnalysis/imageMermaid/imageAnalysisError a cada evidencia.
const analyzeImages = async (serializedTree) => {
  const imageEvidences = collectImageEvidences(serializedTree, null, '');

  for (const item of imageEvidences) {
    const context = buildImageContext(item);
    try {
      const dataUrl = readEvidenceFileAsDataUrl(item.evidence);
      const analysis = await azureOpenAiClient.analyzeImageEvidence(dataUrl, context);
      item.evidence.imageAnalysis = analysis.description;
      item.evidence.imageMermaid = analysis.isDiagram ? analysis.mermaid : null;
    } catch (err) {
      item.evidence.imageAnalysisError = err.message;
    }
  }
};

const generateDocumentSection = async (documentId, { instructions } = {}) => {
  const document = await Document.findById(documentId);
  if (!document) {
    const error = new Error(MESSAGES.DOCUMENT_NOT_FOUND);
    error.code = ERROR_CODES.NOT_FOUND;
    throw error;
  }

  const rules = await Rule.find({ documentId: document._id }).sort({ order: 1 });
  const tree = buildRuleTree(rules);

  if (tree.length === 0) {
    const error = new Error('El documento no tiene reglas ni evidencias para generar un reporte con IA');
    error.code = 'NO_CONTENT';
    throw error;
  }

  // Falla rapido si faltan credenciales, antes de hacer cualquier trabajo (vision o texto).
  azureOpenAiClient.getAzureConfig();

  const ruleIds = rules.map((rule) => rule._id);
  const evidences = ruleIds.length > 0 ? await Evidence.find({ ruleId: { $in: ruleIds } }) : [];
  const evidencesByRule = new Map();
  evidences.forEach((evidence) => {
    const key = String(evidence.ruleId);
    if (!evidencesByRule.has(key)) evidencesByRule.set(key, []);
    evidencesByRule.get(key).push(evidence);
  });

  const serializedTree = tree.map((node) => serializeNode(node, evidencesByRule));

  await analyzeImages(serializedTree);

  const usedSlugs = new Set();
  const tocEntries = [];
  collectTocEntries(serializedTree, '', 0, tocEntries, usedSlugs);

  const warnings = [];
  const bodyLines = [];

  for (const node of serializedTree) {
    try {
      const { markdown, truncated } = await azureOpenAiClient.generateRuleSectionMarkdown(document, node, instructions);
      bodyLines.push('', markdown.trim(), '');
      if (truncated) {
        warnings.push(`La sección "${node.name}" se truncó por límite de tokens de Azure OpenAI`);
      }
    } catch (err) {
      bodyLines.push('', `⚠️ No se pudo generar la sección "${node.name}": ${err.message}`, '');
      warnings.push(`Error generando la sección "${node.name}": ${err.message}`);
    }
  }

  const headLines = [`# ${document.name}`];
  if (document.description && document.description.trim()) {
    headLines.push('', document.description.trim());
  }

  const tocSection = tocEntries.length > 0
    ? ['', '## Tabla de Contenido', '', buildTableOfContents(tocEntries)]
    : [];

  const markdown = `${[...headLines, ...tocSection, ...bodyLines].join('\n').trimEnd()}\n`;
  const generatedAt = new Date();

  try {
    await createEvent(
      'ai_report_generated',
      { warnings: warnings.length },
      { projectId: document.projectId, documentId: document._id }
    );
  } catch (err) {
    logger.error('🔴 Error creating ai_report_generated event', { error: err.message });
  }

  return { markdown, generatedAt, warnings };
};

module.exports = { generateDocumentSection };
