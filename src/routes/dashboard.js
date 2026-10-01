const express = require('express');
const router = express.Router();
const { getStats, getAlerts } = require('../controllers/dashboardController');
const { requirePermission } = require('../middleware/requirePermission');

router.get('/stats', requirePermission('project:read'), getStats);
router.get('/alerts', requirePermission('project:read'), getAlerts);

module.exports = router;
