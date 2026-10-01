const express = require('express');
const router = express.Router();
const { requirePermission } = require('../middleware/requirePermission');
const { createUser, listUsers, updateUserStatus, updateUserProfile, resetPassword, importUsers } = require('../controllers/userController');

router.post('/import', requirePermission('users:write'), importUsers);
router.post('/', requirePermission('users:write'), createUser);
router.get('/', requirePermission('users:write'), listUsers);
router.patch('/:id/status', requirePermission('users:write'), updateUserStatus);
router.patch('/:id', requirePermission('users:write'), updateUserProfile);
router.post('/:id/reset-password', requirePermission('users:write'), resetPassword);

module.exports = router;