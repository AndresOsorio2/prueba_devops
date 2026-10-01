const request = require('supertest');
const createApp = require('../src/app');

describe('CRUD /tasks', () => {
  let app;

  beforeEach(() => {
    app = createApp();
  });

  it('starts empty', async () => {
    const res = await request(app).get('/tasks');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('creates a task', async () => {
    const res = await request(app).post('/tasks').send({ title: 'Probar PoC' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ title: 'Probar PoC', done: false });
  });

  it('rejects a task without title', async () => {
    const res = await request(app).post('/tasks').send({});
    expect(res.status).toBe(400);
  });

  it('gets a task by id', async () => {
    const created = await request(app).post('/tasks').send({ title: 'X' });
    const res = await request(app).get(`/tasks/${created.body.id}`);
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('X');
  });

  it('returns 404 for missing task', async () => {
    const res = await request(app).get('/tasks/999');
    expect(res.status).toBe(404);
  });

  it('updates a task', async () => {
    const created = await request(app).post('/tasks').send({ title: 'X' });
    const res = await request(app).put(`/tasks/${created.body.id}`).send({ done: true });
    expect(res.status).toBe(200);
    expect(res.body.done).toBe(true);
  });

  it('deletes a task', async () => {
    const created = await request(app).post('/tasks').send({ title: 'X' });
    const res = await request(app).delete(`/tasks/${created.body.id}`);
    expect(res.status).toBe(204);
    const after = await request(app).get(`/tasks/${created.body.id}`);
    expect(after.status).toBe(404);
  });
});
