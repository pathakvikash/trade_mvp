const User = require('../models/User');
const jwt = require('jsonwebtoken');
const config = require('../config/config');
const logger = require('../config/logger');
const BaseController = require('./BaseController');

// Register User
exports.registerUser = BaseController.wrap(async (req, res) => {
  const { username, email, password, name, role } = req.body;

  // Check if email exists
  const emailExists = await User.findOne({ email: email.toLowerCase() });
  if (emailExists) {
    return res.status(400).json({
      success: false,
      message: 'Email already registered',
    });
  }

  // Check if username exists
  const usernameExists = await User.findOne({
    username: username.toLowerCase(),
  });
  if (usernameExists) {
    return res.status(400).json({
      success: false,
      message: 'Username already taken',
    });
  }

  // Create user with lowercase email and username
  const user = await User.create({
    username: username.toLowerCase(),
    email: email.toLowerCase(),
    password,
    name,
    role: role === 'admin' ? 'admin' : 'user',
  });

  logger.info(`User created successfully: ${user.username}`);
  res.status(201).json({
    success: true,
    message: 'User created successfully',
    user: {
      _id: user._id,
      username: user.username,
      email: user.email,
      name: user.name,
      role: user.role,
    },
  });
});

// Initialize default users (admin and guest)
exports.initializeDefaultUsers = async () => {
  try {
    const defaultUsers = [
      {
        username: 'admin',
        email: 'admin@cryptozen.com',
        password: 'Admin@123',
        name: 'Admin User',
        role: 'admin',
      },
      {
        username: 'guest',
        email: 'guest@cryptozen.com',
        password: 'Guest@123',
        name: 'Guest User',
        role: 'user',
      },
    ];

    for (const userData of defaultUsers) {
      const existingUser = await User.findOne({ email: userData.email });
      if (!existingUser) {
        await User.create(userData);
        logger.info(`Created default user: ${userData.username}`);
      }
    }
  } catch (error) {
    logger.error('Error initializing default users:', error);
  }
};

// Login User
exports.loginUser = BaseController.wrap(async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email: email.toLowerCase() });

  if (!user) {
    return res.status(401).json({
      success: false,
      message: 'Invalid credentials',
    });
  }

  const isMatch = await user.matchPassword(password);
  if (!isMatch) {
    return res.status(401).json({
      success: false,
      message: 'Invalid credentials',
    });
  }

  const token = jwt.sign(
    { userId: user._id, role: user.role },
    config.jwt.secret,
    { expiresIn: '24h' }
  );

  logger.info(`User logged in successfully: ${user.username}`);
  res.status(200).json({
    success: true,
    token,
    user: {
      _id: user._id,
      username: user.username,
      email: user.email,
      name: user.name,
      role: user.role,
    },
  });
});

// Verify Token
exports.verifyToken = BaseController.wrap(async (req, res) => {
  const user = await User.findById(req.user.userId).select('-password');

  if (!user) {
    return res.status(404).json({
      success: false,
      message: 'User not found',
    });
  }

  res.status(200).json({
    success: true,
    user: {
      _id: user._id,
      username: user.username,
      email: user.email,
      name: user.name,
      role: user.role,
    },
  });
});
