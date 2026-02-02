const mongoose = require('mongoose');

/**
 * OAuthState model for storing OAuth state tokens
 * Used for CSRF protection during OAuth flow
 * States automatically expire after 10 minutes via TTL index
 */
const oauthStateSchema = new mongoose.Schema({
  state: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  returnUrl: {
    type: String
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 600 // TTL: automatically delete after 600 seconds (10 minutes)
  }
});

// Ensure TTL index is created
oauthStateSchema.index({ createdAt: 1 }, { expireAfterSeconds: 600 });

module.exports = mongoose.model('OAuthState', oauthStateSchema);
