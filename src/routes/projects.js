const express = require('express');
const router = express.Router();
const { getProjects, getProject, createProject, updateProject, deleteProject, addParticipants, removeParticipant, changeProjectStatus } = require('../controllers/projectController');
const { requirePermission } = require('../middleware/requirePermission');

router.post('/:id/participants', requirePermission('project:write'), addParticipants);
router.delete('/:id/participants/:userId', requirePermission('project:write'), removeParticipant);
router.get('/', getProjects);
router.get('/:id', getProject);
router.post('/', requirePermission('project:write'), createProject);
router.put('/:id', requirePermission('project:write'), updateProject);
router.patch('/:id/status', requirePermission('project:write'), changeProjectStatus);
router.delete('/:id', requirePermission('project:write'), deleteProject);

module.exports = router;