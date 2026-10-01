const Document = require('../../src/models/Document');

describe('Document schema', () => {
  const responsible = Document.schema.path('responsible');

  test('defines a responsible path (AC1)', () => {
    expect(responsible).toBeDefined();
  });

  test('responsible references User and defaults to null (AC1)', () => {
    expect(responsible.options.ref).toBe('User');
    expect(responsible.options.default).toBeNull();
  });

  test('responsible is optional so existing documents stay valid (AC1)', () => {
    expect(responsible.options.required).toBeFalsy();
  });
});
