const express = require('express');
const router = express.Router();
const { registerUser, loginUser, verifyToken, getMe, updateMe, changePassword, logoutAll, setAvatar, clearAvatar, exportMe, deleteMe, googleLogin, authConfig, devHint } = require('../controllers/authController');
const auth = require('../middleware/auth');
const { limitBy } = require('../middleware/rateLimit');

const { loginRules, registerRules, passwordChangeRules, updateMeRules, avatarRules, deleteAccountRules, googleRules, validate } = require('../middleware/validator');

// Per IP. Limiter first, so invalid requests count too (cheap guard against password guessing).
const loginLimit = limitBy({ limit: 10, windowMs: 60 * 1000 });
const registerLimit = limitBy({ limit: 5, windowMs: 60 * 60 * 1000 });
const passwordLimit = limitBy({ limit: 5, windowMs: 60 * 1000 });
const googleLimit = limitBy({ limit: 10, windowMs: 60 * 1000 });
// Per user (after auth).
const perUser = (limit) => limitBy({ limit, windowMs: 60 * 1000 }, (req) => req.user.userId);
const avatarLimit = perUser(20);
const logoutAllLimit = perUser(5);
const exportLimit = perUser(5);
const deleteLimit = perUser(3);
const devHintLimit = limitBy({ limit: 30, windowMs: 60 * 1000 }); // DEV ONLY: delete when hosted

router.post('/register', registerLimit, registerRules(), validate, registerUser);
router.post('/login', loginLimit, loginRules(), validate, loginUser);
router.get('/verify', auth, verifyToken);
router.get('/me', auth, getMe);
router.patch('/me', auth, updateMeRules(), validate, updateMe);
router.put('/me/avatar', auth, avatarLimit, avatarRules(), validate, setAvatar);
router.delete('/me/avatar', auth, avatarLimit, clearAvatar);
router.get('/me/export', auth, exportLimit, exportMe);
router.delete('/me', auth, deleteLimit, deleteAccountRules(), validate, deleteMe);
router.post('/logout-all', auth, logoutAllLimit, logoutAll);
router.post('/password', passwordLimit, auth, passwordChangeRules(), validate, changePassword);
router.post('/google', googleLimit, googleRules(), validate, googleLogin);
router.get('/config', authConfig);
router.get('/dev-hint', devHintLimit, devHint); // DEV ONLY: delete when hosted

module.exports = router;
