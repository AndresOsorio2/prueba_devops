const Document = require('../models/Document');
const Rule = require('../models/Rule');
const Evidence = require('../models/Evidence');
const { ERROR_CODES, MESSAGES } = require('../utils/messages');

const slugify = (text) => {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
};

const uniqueSlug = (base, usedSlugs) => {
  const root = base || 'section';
  let slug = root;
  let counter = 1;
  while (usedSlugs.has(slug)) {
    slug = `${root}-${counter}`;
    counter += 1;
  }
  usedSlugs.add(slug);
  return slug;
};

const buildRuleTree = (rules) => {
  const nodes = new Map();
  [...rules]
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .forEach((rule) => nodes.set(String(rule._id), { rule, children: [] }));

  const roots = [];
  nodes.forEach((node) => {
    const parentId = node.rule.parentId ? String(node.rule.parentId) : null;
    const parent = parentId ? nodes.get(parentId) : null;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  });

  const sortDeep = (list) => {
    list.sort((a, b) => (a.rule.order || 0) - (b.rule.order || 0));
    list.forEach((node) => sortDeep(node.children));
  };
  sortDeep(roots);

  return roots;
};

const renderTocLine = (entry) => {
  const indent = '   '.repeat(entry.depth);
  return `${indent}${entry.number} [${entry.text}](#${entry.slug})`;
};

const renderEvidenceLine = (evidence) => {
  if (evidence.type === 'file') {
    const name = evidence.originalName || evidence.value;
    return `- **Archivo:** ${name}`;
  }
  if (evidence.type === 'url') {
    return `- **URL:** [${evidence.value}](${evidence.value})`;
  }
  return `- **Nota:** ${evidence.value}`;
};

const appendRule = (node, number, depth, context) => {
  const { tocEntries, bodyLines, evidencesByRule, usedSlugs } = context;
  const slug = uniqueSlug(slugify(node.rule.name), usedSlugs);
  tocEntries.push({ depth: depth + 1, number, text: node.rule.name, slug });

  const headingLevel = 3 + depth;
  const heading = headingLevel <= 6
    ? `${'#'.repeat(headingLevel)} ${node.rule.name}`
    : `**${node.rule.name}**`;
  bodyLines.push('', heading, '');

  const content = (node.rule.markdownContent || '').trim();
  if (content) {
    bodyLines.push(content, '');
  }

  const evidences = evidencesByRule.get(String(node.rule._id)) || [];
  if (evidences.length > 0) {
    bodyLines.push('**Evidencias:**', '');
    evidences.forEach((evidence) => bodyLines.push(renderEvidenceLine(evidence)));
    bodyLines.push('');
  }

  node.children.forEach((child, index) => {
    appendRule(child, `${number}.${index + 1}`, depth + 1, context);
  });
};

const generateDocumentReportMarkdown = async (documentId) => {
  const document = await Document.findById(documentId);
  if (!document) {
    const error = new Error(MESSAGES.DOCUMENT_NOT_FOUND);
    error.code = ERROR_CODES.NOT_FOUND;
    throw error;
  }

  const rules = await Rule.find({ documentId: document._id }).sort({ order: 1 });
  const ruleIds = rules.map((rule) => rule._id);

  const evidences = ruleIds.length > 0
    ? await Evidence.find({ ruleId: { $in: ruleIds } })
    : [];

  const evidencesByRule = new Map();
  evidences.forEach((evidence) => {
    const key = String(evidence.ruleId);
    if (!evidencesByRule.has(key)) evidencesByRule.set(key, []);
    evidencesByRule.get(key).push(evidence);
  });

  const usedSlugs = new Set();
  const tocEntries = [];
  const headLines = [`# ${document.name}`];
  if (document.description && document.description.trim()) {
    headLines.push('', document.description.trim());
  }

  const bodyLines = [];
  const tree = buildRuleTree(rules);
  tree.forEach((node, ruleIndex) => {
    appendRule(node, `${ruleIndex + 1}`, 0, {
      tocEntries,
      bodyLines,
      evidencesByRule,
      usedSlugs
    });
  });

  const tocSection = tocEntries.length > 0
    ? ['', '## Tabla de Contenido', '', ...tocEntries.map(renderTocLine)]
    : [];

  const markdown = `${[...headLines, ...tocSection, ...bodyLines].join('\n').trimEnd()}\n`;

  return { markdown, generatedAt: new Date() };
};

module.exports = {
  slugify,
  uniqueSlug,
  buildRuleTree,
  buildTableOfContents: (entries) => entries.map(renderTocLine).join('\n'),
  generateDocumentReportMarkdown
};
