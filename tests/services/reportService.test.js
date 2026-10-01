jest.mock('../../src/models/Document', () => require('../mocks/mongooseModel')());
jest.mock('../../src/models/Rule', () => require('../mocks/mongooseModel')());
jest.mock('../../src/models/Evidence', () => require('../mocks/mongooseModel')());

const Document = require('../../src/models/Document');
const Rule = require('../../src/models/Rule');
const Evidence = require('../../src/models/Evidence');
const {
  slugify,
  uniqueSlug,
  buildRuleTree,
  buildTableOfContents,
  generateDocumentReportMarkdown
} = require('../../src/services/reportService');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('slugify', () => {
  test('lowercases and hyphenates spaces', () => {
    expect(slugify('Entregable 1')).toBe('entregable-1');
  });

  test('removes accents and punctuation', () => {
    expect(slugify('Arquitectura de Solución — Versión #2')).toBe('arquitectura-de-solucion-version-2');
  });

  test('collapses repeated separators and trims edges', () => {
    expect(slugify('  Ñoño   test  ')).toBe('nono-test');
  });

  test('returns empty string for empty input', () => {
    expect(slugify('')).toBe('');
    expect(slugify(null)).toBe('');
  });
});

describe('uniqueSlug', () => {
  test('returns base slug on first use and suffix on duplicates', () => {
    const used = new Set();
    expect(uniqueSlug(slugify('Regla'), used)).toBe('regla');
    expect(uniqueSlug(slugify('Regla'), used)).toBe('regla-1');
    expect(uniqueSlug(slugify('Regla'), used)).toBe('regla-2');
  });

  test('falls back to section when slug is empty', () => {
    const used = new Set();
    expect(uniqueSlug('', used)).toBe('section');
  });
});

describe('buildTableOfContents', () => {
  test('renders indented numbered links', () => {
    const entries = [
      { depth: 0, number: '1', text: 'Doc A', slug: 'doc-a' },
      { depth: 1, number: '1.1', text: 'Regla', slug: 'regla' },
      { depth: 0, number: '2', text: 'Doc B', slug: 'doc-b' }
    ];
    expect(buildTableOfContents(entries)).toBe(
      '1 [Doc A](#doc-a)\n   1.1 [Regla](#regla)\n2 [Doc B](#doc-b)'
    );
  });
});

describe('buildRuleTree', () => {
  const rule = (id, parentId, order) => ({ _id: id, parentId, order, name: `rule-${id}` });

  test('nests children under parents ordered by order', () => {
    const tree = buildRuleTree([
      rule('b', 'a', 0),
      rule('a', null, 1),
      rule('c', 'b', 5),
      rule('d', 'a', 2)
    ]);

    expect(tree).toHaveLength(1);
    expect(tree[0].rule.name).toBe('rule-a');
    expect(tree[0].children.map((n) => n.rule.name)).toEqual(['rule-b', 'rule-d']);
    expect(tree[0].children[0].children[0].rule.name).toBe('rule-c');
  });

  test('promotes orphan rules to roots', () => {
    const tree = buildRuleTree([rule('x', 'missing-parent', 3)]);
    expect(tree).toHaveLength(1);
    expect(tree[0].rule.name).toBe('rule-x');
  });

  test('sorts roots by order', () => {
    const tree = buildRuleTree([rule('second', null, 2), rule('first', null, 1)]);
    expect(tree.map((n) => n.rule.name)).toEqual(['rule-first', 'rule-second']);
  });

  test('treats missing order as zero when sorting', () => {
    const tree = buildRuleTree([
      { _id: 'a', parentId: null, name: 'A', order: 1 },
      { _id: 'b', parentId: null, name: 'B' },
      { _id: 'c', parentId: null, name: 'C' }
    ]);
    expect(tree.map((n) => n.rule.name)).toEqual(['B', 'C', 'A']);
  });
});

describe('generateDocumentReportMarkdown', () => {
  function arrangeDocument(document) {
    Document.findById.mockResolvedValue(document);
  }

  function arrangeContent({ rules = [], evidences = [] } = {}) {
    Rule.find.mockReturnValue({ sort: jest.fn().mockResolvedValue(rules) });
    Evidence.find.mockResolvedValue(evidences);
  }

  test('throws NOT_FOUND when document does not exist', async () => {
    Document.findById.mockResolvedValue(null);

    await expect(generateDocumentReportMarkdown('d1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  test('generates report with document name as header, toc and evidences', async () => {
    arrangeDocument({ _id: 'd1', name: 'Assessment + POV', description: 'Doc demo' });
    arrangeContent({
      rules: [
        { _id: 'r1', documentId: 'd1', parentId: null, name: 'Arquitectura de Solución', order: 1, markdownContent: 'Intro' },
        { _id: 'r2', documentId: 'd1', parentId: 'r1', name: 'Sub-regla HLD', order: 1, markdownContent: '' }
      ],
      evidences: [
        { ruleId: 'r1', type: 'text', value: 'Aprobado por comité' }
      ]
    });

    const { markdown, generatedAt } = await generateDocumentReportMarkdown('d1');

    expect(generatedAt).toBeInstanceOf(Date);
    expect(markdown).toContain('# Assessment + POV');
    expect(markdown).not.toContain('# Reporte:');
    expect(markdown).toContain('Doc demo');
    expect(markdown).toContain('## Tabla de Contenido');
    expect(markdown).toContain('1 [Arquitectura de Solución](#arquitectura-de-solucion)');
    expect(markdown).toContain('### Arquitectura de Solución');
    expect(markdown).toContain('#### Sub-regla HLD');
    expect(markdown).toContain('- **Nota:** Aprobado por comité');
    expect(markdown.endsWith('\n')).toBe(true);
  });

  test('queries rules and evidences scoped to the document', async () => {
    arrangeDocument({ _id: 'd1', name: 'Doc' });
    arrangeContent();

    await generateDocumentReportMarkdown('d1');

    expect(Rule.find).toHaveBeenCalledWith({ documentId: 'd1' });
    expect(Evidence.find).not.toHaveBeenCalled();
  });

  test('omits toc when document has no rules', async () => {
    arrangeDocument({ _id: 'd1', name: 'Empty', description: '' });
    arrangeContent();

    const { markdown } = await generateDocumentReportMarkdown('d1');

    expect(markdown).toContain('# Empty');
    expect(markdown).not.toContain('Tabla de Contenido');
    expect(markdown.endsWith('\n')).toBe(true);
  });
});
