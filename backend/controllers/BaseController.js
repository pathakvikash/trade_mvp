const logger = require('../config/logger');

class BaseController {
  static wrap(handler) {
    return async (req, res, next) => {
      try {
        await handler(req, res, next);
      } catch (error) {
        try {
          logger.error(error);
        } catch (e) {}
        if (typeof next === 'function') return next(error);
        if (!res.headersSent) {
          res.status(500).json({
            success: false,
            message: error.message || 'Internal Server Error',
          });
        }
      }
    };
  }

  static success(res, data = {}, status = 200) {
    return res.status(status).json({ success: true, ...data });
  }

  static error(res, message = 'Error', status = 500) {
    return res.status(status).json({ success: false, message });
  }
}

module.exports = BaseController;
