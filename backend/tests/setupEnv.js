// Runs before every suite: safe dummy config so tests never depend on (or read secrets from) backend/.env.
// Assigned unconditionally so a developer's real env vars cannot leak into tests; dotenv never overrides them.
process.env.NODE_ENV = 'test';
process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/jest_unused';
process.env.JWT_SECRET = 'jest-dummy-signing-key-0123456789abcdefghij';
process.env.SEED_DEMO_USERS = 'false';
delete process.env.DEMO_GUEST_PASSWORD;
