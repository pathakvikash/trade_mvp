const express = require('express');
const router = express.Router();
const { registerUser, loginUser, verifyToken, getMe, updateMe, changePassword } = require('../controllers/authController');
const auth = require('../middleware/auth');
const { limitBy } = require('../middleware/rateLimit');

const { loginRules, registerRules, passwordChangeRules, updateMeRules, validate } = require('../middleware/validator');

// Per IP. Limiter first, so invalid requests count too (cheap guard against password guessing).
const loginLimit = limitBy({ limit: 10, windowMs: 60 * 1000 });
const registerLimit = limitBy({ limit: 5, windowMs: 60 * 60 * 1000 });
const passwordLimit = limitBy({ limit: 5, windowMs: 60 * 1000 });

router.post('/register', registerLimit, registerRules(), validate, registerUser);
router.post('/login', loginLimit, loginRules(), validate, loginUser);
router.get('/verify', auth, verifyToken);
router.get('/me', auth, getMe);
router.patch('/me', auth, updateMeRules(), validate, updateMe);
router.post('/password', passwordLimit, auth, passwordChangeRules(), validate, changePassword);

module.exports = router;
