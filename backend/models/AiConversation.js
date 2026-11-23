const mongoose = require('mongoose');

const TTL_DAYS = 30;
// One AI analyst conversation. Messages are plain text plus (assistant only) the strategy spec the server accepted.
// Pushed with $slice -40 by the route, so a conversation never holds more than 40 messages.
const messageSchema = new mongoose.Schema({
  role: { type: String, enum: ['user', 'assistant'], required: true },
  text: { type: String, required: true, maxlength: 2000 },
  strategy: { type: mongoose.Schema.Types.Mixed }, // { spec, describe } after parseSpec; never executed
  at: { type: Date, default: Date.now },
}, { _id: false });

const aiConversationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  scope: { type: String, required: true, maxlength: 40 }, // 'kind:symbol'
  title: { type: String, required: true, maxlength: 60 },
  messages: { type: [messageSchema], default: [] },
  updatedAt: { type: Date, default: Date.now, index: { expireAfterSeconds: TTL_DAYS * 86400 } },
});

module.exports = mongoose.model('AiConversation', aiConversationSchema);
