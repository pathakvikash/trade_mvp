// WP0: the controller is a thin wrapper over services/futuresOrders; botId / reason / noAdd reach the ledger spec.
jest.mock('../config/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../middleware/auth', () => (req, res, next) => { req.user = { userId: req.headers['x-user'] }; next(); });
jest.mock('../models/User', () => ({ findById: jest.fn() }));
jest.mock('../models/Position', () => ({ find: jest.fn(), findOne: jest.fn(), findById: jest.fn(), findOneAndUpdate: jest.fn(), countDocuments: jest.fn() }));
jest.mock('../models/FuturesOrder', () => ({ find: jest.fn(), findOne: jest.fn(), findById: jest.fn(), findOneAndUpdate: jest.fn(), countDocuments: jest.fn() }));
jest.mock('../services/futuresLedger', () => ({ run: jest.fn() }));
jest.mock('../services/futuresRest', () => ({ isKnownSymbol: jest.fn() }));
jest.mock('../services/futuresService', () => ({ getMark: jest.fn() }));
jest.mock('../services/tradeFill', () => ({
  fillPrice: jest.fn(),
  userIdOf: (req) => (req.user && /^[a-f0-9]{24}$/.test(req.user.userId) ? String(req.user.userId) : null),
}));

const mongoose = require('mongoose');
const User = require('../models/User');
const Position = require('../models/Position');
const ledger = require('../services/futuresLedger');
const futuresRest = require('../services/futuresRest');
const { fillPrice } = require('../services/tradeFill');
const orders = require('../services/futuresOrders');
const controller = require('../controllers/futuresController');

const oid = () => new mongoose.Types.ObjectId();
const lean = (v) => ({ lean: async () => v });
const mkRes = () => {
  const res = { status: jest.fn(() => res), json: jest.fn(() => res) };
  return res;
};
const userId = String(oid());

beforeEach(() => {
  jest.resetAllMocks();
  jest.restoreAllMocks();
  fillPrice.mockResolvedValue({ price: 100 });
  futuresRest.isKnownSymbol.mockResolvedValue(true);
  User.findById.mockReturnValue({ select: () => lean({ balance: 900 }) });
  Position.findOne.mockReturnValue(lean(null));
  Position.countDocuments.mockResolvedValue(0);
  ledger.run.mockImplementation(async (spec) => ({ ok: true, op: { targets: [{ id: spec.targets[0].id }] } }));
});

test('openMarket persists botId in the created position and returns cents', async () => {
  const botId = oid();
  const positionId = String(oid());
  Position.findById.mockReturnValue(lean({ _id: positionId, botId }));
  const r = await orders.openMarket({ userId, symbol: 'BTC', side: 'long', size: 1, leverage: 10, positionId, botId });
  const spec = ledger.run.mock.calls[0][0];
  expect(spec.targets[0].create.botId).toBe(botId);
  expect(String(spec.targets[0].id)).toBe(positionId);
  expect(Number.isInteger(r.fill.feeCents)).toBe(true);
  expect(r.fill.price).toBe(100);
});

test('openMarket without botId leaves it out; noAdd on an existing position is POSITION_CONFLICT with no ledger call', async () => {
  Position.findById.mockReturnValue(lean({}));
  await orders.openMarket({ userId, symbol: 'BTC', side: 'long', size: 1, leverage: 10 });
  expect('botId' in ledger.run.mock.calls[0][0].targets[0].create).toBe(false);
  ledger.run.mockClear();
  Position.findOne.mockReturnValue(lean({ _id: oid(), size: 1, leverage: 10, lockOp: null }));
  await expect(orders.openMarket({ userId, symbol: 'BTC', side: 'long', size: 1, leverage: 10, noAdd: true }))
    .rejects.toMatchObject({ status: 409, code: 'POSITION_CONFLICT' });
  expect(ledger.run).not.toHaveBeenCalled();
});

test('closeMarket stores reason bot as closeReason on a final close', async () => {
  const id = oid();
  const pos = { _id: id, userId, symbol: 'BTC', side: 'long', size: 1, entryPrice: 100, leverage: 10, margin: 10, mmr: 0.005, liqPrice: 90, realizedPnl: 0, fees: 0.05, status: 'open', lockOp: null };
  Position.findOne.mockReturnValue(lean(pos));
  const r = await orders.closeMarket({ userId, positionId: String(id), reason: 'bot' });
  expect(ledger.run.mock.calls[0][0].post[String(id)].closeReason).toBe('bot');
  expect(Number.isInteger(r.close.creditCents)).toBe(true);
});

test('controller placeOrder and closePosition call the service functions', async () => {
  const open = jest.spyOn(orders, 'openMarket').mockResolvedValue({ position: { _id: 'p' }, fill: { price: 100, feeCents: 5 } });
  const res = mkRes();
  await controller.placeOrder({ user: { userId }, body: { symbol: 'BTC', side: 'long', type: 'market', size: 1, leverage: 10 } }, res, jest.fn());
  expect(open).toHaveBeenCalledWith(expect.objectContaining({ userId, symbol: 'BTC', size: 1 }));
  expect(res.json.mock.calls[0][0].fill).toEqual({ price: 100, fee: 0.05 });

  const close = jest.spyOn(orders, 'closeMarket').mockResolvedValue({ position: { _id: 'p' }, close: { size: 1, price: 101, pnlCents: 100, feeCents: 5, creditCents: 1100 } });
  const id = String(oid());
  const res2 = mkRes();
  await controller.closePosition({ user: { userId }, params: { id }, body: {} }, res2, jest.fn());
  expect(close).toHaveBeenCalledWith({ userId, positionId: id, size: undefined });
  expect(res2.json.mock.calls[0][0].close).toEqual({ size: 1, price: 101, pnl: 1, fee: 0.05, credit: 11 });
});
