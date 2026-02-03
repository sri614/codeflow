require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const connectDB = require('./config/database');

// Import routes
const oauthRoutes = require('./routes/oauth');
const actionsRoutes = require('./routes/actions');
const snippetsRoutes = require('./routes/snippets');
const secretsRoutes = require('./routes/secrets');
const logsRoutes = require('./routes/logs');
const usageRoutes = require('./routes/usage');

const app = express();
const PORT = process.env.PORT || 3000;

// Connect to MongoDB
connectDB();

// CORS configuration for HubSpot domains and local development
const corsOptions = {
  origin: [
    'https://app.hubspot.com',
    'https://app-eu1.hubspot.com',
    'https://app-na1.hubspot.com',
    /\.hubspot\.com$/,
    /\.ngrok-free\.dev$/,
    /\.ngrok\.io$/,
    'http://localhost:5173',
    'http://localhost:3000',
    'http://127.0.0.1:5173',
    process.env.BASE_URL
  ].filter(Boolean),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-HubSpot-Signature', 'X-HubSpot-Signature-Version', 'ngrok-skip-browser-warning']
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging in development
if (process.env.NODE_ENV === 'development') {
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
    next();
  });
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
app.use('/oauth', oauthRoutes);
app.use('/v1/actions', actionsRoutes);
app.use('/v1/snippets', snippetsRoutes);
app.use('/v1/secrets', secretsRoutes);
app.use('/v1/logs', logsRoutes);
app.use('/v1/usage', usageRoutes);

// Serve static files from React app in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'client/dist')));

  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'client/dist/index.html'));
  });
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, () => {
  console.log(`CodeFlow server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
