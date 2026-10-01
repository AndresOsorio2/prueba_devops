const Event = require('../../src/models/Event');

describe('Event schema', () => {
  const enumValues = Event.schema.path('eventType').enumValues;

  test('eventType enum includes ai_report_generated', () => {
    expect(enumValues).toContain('ai_report_generated');
  });

  test('eventType enum includes the documented report events', () => {
    expect(enumValues).toEqual(expect.arrayContaining(['report_generated', 'report_edited']));
  });

  test('eventType enum includes document_responsible_changed (AC8)', () => {
    expect(enumValues).toContain('document_responsible_changed');
  });

  test('eventType enum includes user_profile_updated', () => {
    expect(enumValues).toContain('user_profile_updated');
  });
});