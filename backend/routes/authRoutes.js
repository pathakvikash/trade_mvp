const express = require('express');
const router = express.Router();
const { registerUser, loginUser, verifyToken } = require('../controllers/authController');
const auth = require('../middleware/auth');

const { userValidationRules, validate } = require('../middleware/validator');

router.post('/register', userValidationRules(), validate, registerUser);
router.post('/login', userValidationRules(), validate, loginUser);
router.get('/verify', auth, verifyToken);

module.exports = router;
