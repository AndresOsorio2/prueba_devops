jest.mock('../../src/logger/seqLogger', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));

const logger = require('../../src/logger/seqLogger');
const {
  respondError,
  respondAccessError,
  respondInternalError
} = require('../../src/utils/respondError');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('respondError', () => {
  test('sets the status and sends the failure envelope', () => {
    const res = mockRes();

    respondError(res, 404, 'NOT_FOUND', 'Project not found');

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Project not found' }
    });
  });

  test('sets success to false regardless of the code and message given', () => {
    const res = mockRes();

    respondError(res, 403, 'FORBIDDEN', 'No eres participante del proyecto');

    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'FORBIDDEN', message: 'No eres participante del proyecto' }
    });
  });

  test('returns the res so callers can `return respondError(...)`', () => {
    const res = mockRes();

    const returned = respondError(res, 400, 'VALIDATION_ERROR', 'algo');

    expect(returned).toBe(res);
  });

  test('does not leak any extra key into the envelope', () => {
    const res = mockRes();

    respondError(res, 500, 'INTERNAL_ERROR', 'boom');

    expect(Object.keys(res.json.mock.calls[0][0])).toEqual(['success', 'error']);
    expect(Object.keys(res.json.mock.calls[0][0].error)).toEqual(['code', 'message']);
  });
});

describe('respondAccessError', () => {
  test('relays the status and the error carried by the access envelope', () => {
    const res = mockRes();
    const access = { ok: false, status: 404, error: { code: 'NOT_FOUND', message: 'Document not found' } };

    respondAccessError(res, access);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Document not found' }
    });
  });

  test('relays a 403 forbidden envelope', () => {
    const res = mockRes();
    const access = { ok: false, status: 403, error: { code: 'FORBIDDEN', message: 'No eres participante del proyecto' } };

    respondAccessError(res, access);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'FORBIDDEN', message: 'No eres participante del proyecto' }
    });
  });

  test('returns the res so callers can `return respondAccessError(...)`', () => {
    const res = mockRes();

    const returned = respondAccessError(res, { ok: false, status: 404, error: { code: 'NOT_FOUND', message: 'x' } });

    expect(returned).toBe(res);
  });
});

describe('respondInternalError', () => {
  test('responds 500 with the INTERNAL_ERROR code and the error message', () => {
    const res = mockRes();

    respondInternalError(res, new Error('DB down'));

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'DB down' }
    });
  });

  test('relays any error-like object exposing a message property', () => {
    const res = mockRes();

    respondInternalError(res, { message: 'timeout' });

    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'timeout' }
    });
  });

  test('returns the res so callers can `return respondInternalError(...)`', () => {
    const res = mockRes();

    const returned = respondInternalError(res, new Error('boom'));

    expect(returned).toBe(res);
  });

  test('logs the error before responding so failures leave a trace in SEQ', () => {
    const res = mockRes();

    respondInternalError(res, new Error('DB down'));

    expect(logger.error).toHaveBeenCalledWith('🔴 Internal server error', { error: 'DB down' });
  });
});
