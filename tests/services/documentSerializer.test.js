jest.mock('../../src/models/User', () => require('../mocks/mongooseModel')());

const User = require('../../src/models/User');
const {
  serializeDocument,
  serializeDocuments,
  RESPONSIBLE_PROJECTION
} = require('../../src/services/documentSerializer');

const RESPONSIBLE_ID = '507f1f77bcf86cd799439030';
const OTHER_RESPONSIBLE_ID = '507f1f77bcf86cd799439031';

function user(overrides = {}) {
  return {
    _id: RESPONSIBLE_ID,
    email: 'owner@softwareone.com',
    passwordHash: 'secret-hash',
    permissions: ['document:read'],
    ...overrides
  };
}

function selects(result) {
  return { select: jest.fn().mockResolvedValue(result) };
}

function plain(overrides = {}) {
  return { _id: 'd1', name: 'Assessment', responsible: null, ...overrides };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('documentSerializer', () => {
  describe('serializeDocument', () => {
    test('resolves the responsible into a public projection (AC2, AC9)', async () => {
      User.findById.mockReturnValue(selects(user()));

      const result = await serializeDocument(plain({ responsible: RESPONSIBLE_ID }));

      expect(User.findById).toHaveBeenCalledWith(RESPONSIBLE_ID);
      expect(result.responsible).toEqual({ _id: RESPONSIBLE_ID, email: 'owner@softwareone.com' });
    });

    test('never leaks passwordHash or permissions of the responsible (AC2)', async () => {
      User.findById.mockReturnValue(selects(user()));

      const result = await serializeDocument(plain({ responsible: RESPONSIBLE_ID }));

      expect(result.responsible).not.toHaveProperty('passwordHash');
      expect(result.responsible).not.toHaveProperty('permissions');
    });

    test('requests the prospective projection so f95 fields appear without rework (D-105)', async () => {
      User.findById.mockReturnValue(selects(user()));

      await serializeDocument(plain({ responsible: RESPONSIBLE_ID }));

      expect(User.findById.mock.results[0].value.select).toHaveBeenCalledWith(RESPONSIBLE_PROJECTION);
    });

    test('keeps name fields once the User has them (D-105)', async () => {
      User.findById.mockReturnValue(selects(user({ firstName: 'Ada', lastName: 'Lovelace', jobTitle: 'Architect' })));

      const result = await serializeDocument(plain({ responsible: RESPONSIBLE_ID }));

      expect(result.responsible).toEqual({
        _id: RESPONSIBLE_ID,
        email: 'owner@softwareone.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
        jobTitle: 'Architect'
      });
    });

    test('returns a null responsible and skips the query when the document has none (AC1, AC3)', async () => {
      const result = await serializeDocument(plain({ responsible: null }));

      expect(result.responsible).toBeNull();
      expect(User.findById).not.toHaveBeenCalled();
    });

    test('returns a null responsible when the referenced user no longer exists', async () => {
      User.findById.mockReturnValue(selects(null));

      const result = await serializeDocument(plain({ responsible: RESPONSIBLE_ID }));

      expect(result.responsible).toBeNull();
    });

    test('preserves the rest of the document fields', async () => {
      User.findById.mockReturnValue(selects(user()));

      const result = await serializeDocument(plain({ responsible: RESPONSIBLE_ID, status: 'in_progress' }));

      expect(result._id).toBe('d1');
      expect(result.name).toBe('Assessment');
      expect(result.status).toBe('in_progress');
    });

    test('merges extra fields such as the rules of a detail read (AC9)', async () => {
      User.findById.mockReturnValue(selects(user()));
      const rules = [{ _id: 'r1' }];

      const result = await serializeDocument(plain({ responsible: RESPONSIBLE_ID }), { rules });

      expect(result.rules).toBe(rules);
    });

    test('unwraps a mongoose document through toObject (AC9)', async () => {
      User.findById.mockReturnValue(selects(user()));
      const mongooseLike = { toObject: jest.fn().mockReturnValue(plain({ responsible: RESPONSIBLE_ID })) };

      const result = await serializeDocument(mongooseLike);

      expect(mongooseLike.toObject).toHaveBeenCalled();
      expect(result.responsible).toEqual({ _id: RESPONSIBLE_ID, email: 'owner@softwareone.com' });
    });

    test('accepts an already populated responsible object', async () => {
      User.findById.mockReturnValue(selects(user()));

      const result = await serializeDocument(plain({ responsible: { _id: RESPONSIBLE_ID, email: 'stale@softwareone.com' } }));

      expect(User.findById).toHaveBeenCalledWith(RESPONSIBLE_ID);
      expect(result.responsible).toEqual({ _id: RESPONSIBLE_ID, email: 'owner@softwareone.com' });
    });

    test('survives a missing user model result without throwing', async () => {
      User.findById.mockReturnValue(selects(undefined));

      const result = await serializeDocument(plain({ responsible: RESPONSIBLE_ID }));

      expect(result.responsible).toBeNull();
    });
  });

  describe('serializeDocuments', () => {
    test('resolves every responsible with a single batched query (AC9)', async () => {
      const query = selects([user(), user({ _id: OTHER_RESPONSIBLE_ID, email: 'second@softwareone.com' })]);
      User.find.mockReturnValue(query);

      const result = await serializeDocuments([
        plain({ _id: 'd1', responsible: RESPONSIBLE_ID }),
        plain({ _id: 'd2', responsible: OTHER_RESPONSIBLE_ID })
      ]);

      expect(User.find).toHaveBeenCalledTimes(1);
      expect(User.find).toHaveBeenCalledWith({ _id: { $in: [RESPONSIBLE_ID, OTHER_RESPONSIBLE_ID] } });
      expect(result[0].responsible).toEqual({ _id: RESPONSIBLE_ID, email: 'owner@softwareone.com' });
      expect(result[1].responsible).toEqual({ _id: OTHER_RESPONSIBLE_ID, email: 'second@softwareone.com' });
    });

    test('leaves documents without a responsible as null and skips the query (AC9)', async () => {
      const result = await serializeDocuments([plain({ _id: 'd1' }), plain({ _id: 'd2' })]);

      expect(result.map((d) => d.responsible)).toEqual([null, null]);
      expect(User.find).not.toHaveBeenCalled();
    });

    test('mixes documents with and without a responsible', async () => {
      User.find.mockReturnValue(selects([user()]));

      const result = await serializeDocuments([
        plain({ _id: 'd1', responsible: RESPONSIBLE_ID }),
        plain({ _id: 'd2', responsible: null })
      ]);

      expect(result[0].responsible).toEqual({ _id: RESPONSIBLE_ID, email: 'owner@softwareone.com' });
      expect(result[1].responsible).toBeNull();
    });

    test('handles an empty list without querying', async () => {
      const result = await serializeDocuments([]);

      expect(result).toEqual([]);
      expect(User.find).not.toHaveBeenCalled();
    });

    test('returns null for a responsible that the batch query did not return', async () => {
      User.find.mockReturnValue(selects([]));

      const result = await serializeDocuments([plain({ responsible: RESPONSIBLE_ID })]);

      expect(result[0].responsible).toBeNull();
    });

    test('survives a batch query that resolves to nothing', async () => {
      User.find.mockReturnValue(selects(undefined));

      const result = await serializeDocuments([plain({ responsible: RESPONSIBLE_ID })]);

      expect(result[0].responsible).toBeNull();
    });
  });
});
