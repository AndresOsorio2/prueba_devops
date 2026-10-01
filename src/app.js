const express = require('express');

function createApp() {
  const app = express();
  app.use(express.json());

  // Almacén en memoria, sin dependencias externas.
  let tasks = [];
  let nextId = 1;

  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/tasks', (req, res) => {
    res.json(tasks);
  });

  app.post('/tasks', (req, res) => {
    const { title } = req.body;
    if (!title) return res.status(400).json({ error: 'title is required' });
    const task = { id: nextId++, title, done: false };
    tasks.push(task);
    res.status(201).json(task);
  });

  app.get('/tasks/:id', (req, res) => {
    const task = tasks.find((t) => t.id === Number(req.params.id));
    if (!task) return res.status(404).json({ error: 'not found' });
    res.json(task);
  });

  app.put('/tasks/:id', (req, res) => {
    const task = tasks.find((t) => t.id === Number(req.params.id));
    if (!task) return res.status(404).json({ error: 'not found' });
    Object.assign(task, req.body);
    res.json(task);
  });

  app.delete('/tasks/:id', (req, res) => {
    const before = tasks.length;
    tasks = tasks.filter((t) => t.id !== Number(req.params.id));
    if (tasks.length === before) return res.status(404).json({ error: 'not found' });
    res.status(204).send();
  });

  return app;
}

module.exports = createApp;
