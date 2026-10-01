jest.mock('../../src/models/Document', () => require('../mocks/mongooseModel')());
jest.mock('../../src/models/Project', () => require('../mocks/mongooseModel')());

const Document = require('../../src/models/Document');
const Project = require('../../src/models/Project');
const { hasProjectAccess, resolveDocumentWithAccess, visibleProjectFilter } = require('../../src/services/documentAccessService');

const PROJECT_WRITER = { _id: 'me', permissions: ['project:write'] };
const READER = { _id: 'me', permissions: ['document:read'] };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('hasProjectAccess', () => {
  test('allows a user with project:write regardless of participants', () => {
    const project = { _id: 'p1', participants: [] };
    expect(hasProjectAccess(PROJECT_WRITER, project)).toBe(true);
  });

  test('allows a participant without project:write', () => {
    const project = { _id: 'p1', participants: ['me'] };
    expect(hasProjectAccess(READER, project)).toBe(true);
  });

  test('rejects a non-participant without project:write', () => {
    const project = { _id: 'p1', participants: ['other'] };
    expect(hasProjectAccess(READER, project)).toBe(false);
  });

  test('rejects when the project has no participants array', () => {
    const project = { _id: 'p1' };
    expect(hasProjectAccess(READER, project)).toBe(false);
  });

  test('rejects when the user has no id', () => {
    const project = { _id: 'p1', participants: ['me'] };
    expect(hasProjectAccess({ permissions: ['document:read'] }, project)).toBe(false);
  });

  test('rejects a null user and null project', () => {
    expect(hasProjectAccess(null, null)).toBe(false);
  });

  test('matches participants by string id regardless of type (ObjectId vs string)', () => {
    const project = { _id: 'p1', participants: ['507f1f77bcf86cd799439011'] };
    const user = { _id: '507f1f77bcf86cd799439011', permissions: [] };
    expect(hasProjectAccess(user, project)).toBe(true);
  });
});

describe('resolveDocumentWithAccess', () => {
  test('returns 404 NOT_FOUND when the document does not exist', async () => {
    Document.findById.mockResolvedValue(null);

    const result = await resolveDocumentWithAccess(PROJECT_WRITER, 'd1');

    expect(result).toEqual({ ok: false, status: 404, error: { code: 'NOT_FOUND', message: 'Document not found' } });
    expect(Project.findById).not.toHaveBeenCalled();
  });

  test('returns 404 NOT_FOUND when the owning project does not exist', async () => {
    Document.findById.mockResolvedValue({ _id: 'd1', projectId: 'p1' });
    Project.findById.mockResolvedValue(null);

    const result = await resolveDocumentWithAccess(PROJECT_WRITER, 'd1');

    expect(Project.findById).toHaveBeenCalledWith('p1');
    expect(result).toEqual({ ok: false, status: 404, error: { code: 'NOT_FOUND', message: 'Project not found' } });
  });

  test('returns 403 FORBIDDEN when the user is a non-participant without project:write', async () => {
    Document.findById.mockResolvedValue({ _id: 'd1', projectId: 'p1' });
    Project.findById.mockResolvedValue({ _id: 'p1', participants: ['other'] });

    const result = await resolveDocumentWithAccess(READER, 'd1');

    expect(result).toEqual({ ok: false, status: 403, error: { code: 'FORBIDDEN', message: 'No eres participante del proyecto' } });
  });

  test('resolves the document for a project:write user even without participants', async () => {
    const document = { _id: 'd1', projectId: 'p1' };
    Document.findById.mockResolvedValue(document);
    Project.findById.mockResolvedValue({ _id: 'p1', participants: [] });

    const result = await resolveDocumentWithAccess(PROJECT_WRITER, 'd1');

    expect(result).toEqual({ ok: true, document });
  });

  test('resolves the document for a participant without project:write', async () => {
    const document = { _id: 'd1', projectId: 'p1' };
    Document.findById.mockResolvedValue(document);
    Project.findById.mockResolvedValue({ _id: 'p1', participants: ['me'] });

    const result = await resolveDocumentWithAccess(READER, 'd1');

    expect(result).toEqual({ ok: true, document });
  });
});
// Feature 113: el helper de lista. Su hermano hasProjectAccess resuelve el caso documento;
// este resuelve el caso consulta, que es el que dashboard necesita (D-107).
describe('visibleProjectFilter', () => {
  describe('global scope (project:write)', () => {
    test('returns an empty filter so nothing is scoped', () => {
      expect(visibleProjectFilter(PROJECT_WRITER)).toEqual({});
    });

    test('does not restrict by participants even for a writer who participates in nothing', () => {
      expect(visibleProjectFilter({ ...PROJECT_WRITER, _id: 'writer-elsewhere' }).participants).toBeUndefined();
    });
  });

  describe('filtered scope (no project:write)', () => {
    test('scopes by the own id of the user', () => {
      expect(visibleProjectFilter(READER)).toEqual({ participants: READER._id });
    });

    test('scopes through participants, never through an $or', () => {
      // El $or de projectController.js:22-25 es de busqueda de texto. La participacion es igualdad.
      expect(Object.keys(visibleProjectFilter(READER))).toEqual(['participants']);
    });

    test('scopes a user with an empty permission list', () => {
      expect(visibleProjectFilter({ _id: 'no-perms', permissions: [] })).toEqual({ participants: 'no-perms' });
    });

    test('scopes a user whose permissions field is not an array', () => {
      expect(visibleProjectFilter({ _id: 'broken', permissions: null })).toEqual({ participants: 'broken' });
    });
  });

  describe('no identity available (D-113)', () => {
    test('returns the global filter when there is no user', () => {
      expect(visibleProjectFilter(undefined)).toEqual({});
      expect(visibleProjectFilter(null)).toEqual({});
    });

    test('returns the global filter when the user has no _id', () => {
      expect(visibleProjectFilter({ permissions: [] })).toEqual({});
    });
  });

  describe('composable con una query existente', () => {
    test('spreads into a query that already filters by status', () => {
      const query = { status: { $ne: 'unavailable' }, ...visibleProjectFilter(READER) };

      expect(query).toEqual({ status: { $ne: 'unavailable' }, participants: READER._id });
    });

    test('leaves the query untouched for a writer', () => {
      const query = { status: { $ne: 'unavailable' }, ...visibleProjectFilter(PROJECT_WRITER) };

      expect(query).toEqual({ status: { $ne: 'unavailable' } });
    });
  });

  describe('consistencia con hasProjectAccess', () => {
    test('a project the filter scopes out is one hasProjectAccess rejects', () => {
      const mine = { _id: 'p1', participants: ['me'] };
      const theirs = { _id: 'p2', participants: ['otro'] };

      expect(visibleProjectFilter(READER)).toEqual({ participants: 'me' });
      expect(hasProjectAccess(READER, mine)).toBe(true);
      expect(hasProjectAccess(READER, theirs)).toBe(false);
    });

    test('a writer passes both, so both keep the global picture', () => {
      expect(visibleProjectFilter(PROJECT_WRITER)).toEqual({});
      expect(hasProjectAccess(PROJECT_WRITER, { _id: 'p2', participants: [] })).toBe(true);
    });
  });

  test('the helper is pure: it never touches a Model', () => {
    visibleProjectFilter(READER);

    expect(Project.find).not.toHaveBeenCalled();
    expect(Document.find).not.toHaveBeenCalled();
  });
});
