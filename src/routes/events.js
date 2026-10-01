const express = require('express');
const router = express.Router();
const { getEvents, getTimeline } = require('../controllers/eventController');

// Sin permiso de modulo a proposito: el historial de eventos y el timeline exigen
// participacion en el proyecto (o project:write), no un permiso. Aplicar project:read
// abriria el historial de proyectos ajenos, que es justo lo que el spec de f92 cierra.
router.get('/:id/events', getEvents);
router.get('/:id/timeline', getTimeline);

module.exports = router;
