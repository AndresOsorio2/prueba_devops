const { ERROR_CODES, MESSAGES } = require('../../src/utils/messages');

describe('ERROR_CODES', () => {
  test('exposes exactly the codes shared by more than one site', () => {
    expect(Object.keys(ERROR_CODES).sort()).toEqual([
      'FORBIDDEN',
      'INTERNAL_ERROR',
      'NOT_FOUND',
      'UNAUTHENTICATED',
      'UNAUTHORIZED',
      'VALIDATION_ERROR'
    ]);
  });

  test('pins each code to its exact string', () => {
    expect(ERROR_CODES.NOT_FOUND).toBe('NOT_FOUND');
    expect(ERROR_CODES.INTERNAL_ERROR).toBe('INTERNAL_ERROR');
    expect(ERROR_CODES.VALIDATION_ERROR).toBe('VALIDATION_ERROR');
    expect(ERROR_CODES.FORBIDDEN).toBe('FORBIDDEN');
    expect(ERROR_CODES.UNAUTHENTICATED).toBe('UNAUTHENTICATED');
    expect(ERROR_CODES.UNAUTHORIZED).toBe('UNAUTHORIZED');
  });

  test('keeps UNAUTHORIZED and UNAUTHENTICATED distinct (H-001 is reported, not fixed)', () => {
    expect(ERROR_CODES.UNAUTHORIZED).not.toBe(ERROR_CODES.UNAUTHENTICATED);
  });
});

describe('MESSAGES', () => {
  test('freezes the not-found strings, English, exactly as they were', () => {
    expect(MESSAGES.PROJECT_NOT_FOUND).toBe('Project not found');
    expect(MESSAGES.DOCUMENT_NOT_FOUND).toBe('Document not found');
    expect(MESSAGES.TEMPLATE_NOT_FOUND).toBe('Template not found');
    expect(MESSAGES.RULE_NOT_FOUND).toBe('Rule not found');
    expect(MESSAGES.EVIDENCE_NOT_FOUND).toBe('Evidence not found');
  });

  test('freezes the two participation messages as separate keys', () => {
    expect(MESSAGES.NOT_A_PARTICIPANT).toBe('No eres participante del proyecto');
    expect(MESSAGES.RESPONSIBLE_MUST_BE_PARTICIPANT).toBe('El usuario debe agregarse primero como participante del proyecto');
  });

  test('does not merge the two participation messages (D-005, R-3)', () => {
    expect(MESSAGES.NOT_A_PARTICIPANT).not.toBe(MESSAGES.RESPONSIBLE_MUST_BE_PARTICIPANT);
  });

  test('freezes the authentication messages', () => {
    expect(MESSAGES.AUTHENTICATION_REQUIRED).toBe('Autenticación requerida');
    expect(MESSAGES.SESSION_EXPIRED).toBe('Sesión inválida o expirada');
  });

  test('freezes the domain messages', () => {
    expect(MESSAGES.DOCUMENT_COMPLETED).toBe('Cannot modify completed document');
    expect(MESSAGES.PROJECT_CLOSED).toBe('Cannot add documents to a completed or unavailable project');
  });

  test('freezes the masked internal server message used by the global error handler', () => {
    expect(MESSAGES.INTERNAL_SERVER_ERROR).toBe('Internal server error');
  });

  test('exposes PERMISSION_REQUIRED as a formatter, not a frozen string', () => {
    expect(typeof MESSAGES.PERMISSION_REQUIRED).toBe('function');
    expect(MESSAGES.PERMISSION_REQUIRED('project:write')).toBe('Permiso requerido: project:write');
  });

  test('covers every duplicated message planned for the migration', () => {
    expect(Object.keys(MESSAGES).sort()).toEqual([
      'AUTHENTICATION_REQUIRED',
      'DOCUMENT_COMPLETED',
      'DOCUMENT_NOT_FOUND',
      'EVIDENCE_NOT_FOUND',
      'INTERNAL_SERVER_ERROR',
      'NOT_A_PARTICIPANT',
      'PERMISSION_REQUIRED',
      'PROJECT_CLOSED',
      'PROJECT_NOT_FOUND',
      'RESPONSIBLE_MUST_BE_PARTICIPANT',
      'RULE_NOT_FOUND',
      'SESSION_EXPIRED',
      'TEMPLATE_NOT_FOUND'
    ]);
  });
});
