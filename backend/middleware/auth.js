const jwt = require('jsonwebtoken');
const config = require('../config/config');
const User = require('../models/User');

// Deleted, locked, issued before the last password change, or carrying a stale tokenVersion (`tv`, bumped by password
// change / sign-out-everywhere) all fail; a token without tv counts as 0 so sessions survive the deploy that added it; fails closed on DB error / bad userId.
async function accountOk(decoded) {
  try {
    const user = await User.findById(decoded.userId).select('lockedAt passwordChangedAt tokenVersion').lean();
    return !!user && !user.lockedAt && (decoded.tv || 0) === (user.tokenVersion || 0)
      && !(user.passwordChangedAt && decoded.iat < Math.floor(user.passwordChangedAt.getTime() / 1000));
  } catch (e) {
    return false;
  }
}

module.exports = async (req, res, next) => {
  let decoded;
  try {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No token provided'
      });
    }

    decoded = jwt.verify(token, config.jwt.secret, { algorithms: ['HS256'] });
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Invalid token'
    });
  }

  if (!(await accountOk(decoded))) return res.status(401).json({ success: false, message: 'Invalid token' });

  req.user = decoded;
  next();
};
module.exports.accountOk = accountOk;
