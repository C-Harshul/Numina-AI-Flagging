import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
// Get current directory for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Load environment variables from .env file in the server directory
dotenv.config({ path: join(__dirname, '.env') });

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import ruleRoutes from './routes/rules.js';
import geminiRoutes from './routes/gemini.js';
import executionRoutes from './routes/execution.js';
import oauthRoutes from './routes/oauth.js';
import fetch from 'node-fetch';
import { tokenStore } from './services/tokenStore.js';
import { oauthStateStore } from './services/oauthStateStore.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Log environment variables for debugging (remove in production)
console.log('🔧 Environment variables loaded:');
console.log('- PORT:', process.env.PORT || '3001 (default)');
console.log('- NODE_ENV:', process.env.NODE_ENV || 'development (default)');
console.log('- FRONTEND_URL:', process.env.FRONTEND_URL || 'not set');
console.log('- GEMINI_API_KEY:', process.env.GEMINI_API_KEY ? '✅ Set' : '❌ Not set');
console.log('- VITE_GEMINI_API_KEY:', process.env.VITE_GEMINI_API_KEY ? '✅ Set' : '❌ Not set');

// Security middleware
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      error: 'Too many requests from this IP, please try again later.'
    });
  }
});
app.use('/api/', limiter);

// CORS configuration
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? process.env.FRONTEND_URL 
    : ['http://localhost:5173', 'http://localhost:3000'],
  credentials: true,
}));

// Logging
app.use(morgan('combined'));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    gemini_configured: !!(process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY)
  });
});

// API routes
app.use('/api/rules', ruleRoutes);
app.use('/api/gemini', geminiRoutes);
app.use('/api/execution', executionRoutes);
app.use('/api/oauth', oauthRoutes);

// OAuth callback route (simpler path for QuickBooks)
// This needs to be a direct route, not mounted router
app.get('/callback', async (req, res) => {
  try {
    const { code, state, realmId, error } = req.query;

    if (error) {
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      return res.redirect(`${frontendUrl}/?oauth_error=${encodeURIComponent(error)}`);
    }

    if (!code || !state) {
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      return res.redirect(`${frontendUrl}/?oauth_error=${encodeURIComponent('Missing authorization code or state')}`);
    }

    // Verify state for CSRF protection
    const stateData = oauthStateStore.get(state);
    if (!stateData) {
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      return res.redirect(`${frontendUrl}/?oauth_error=${encodeURIComponent('Invalid or expired state parameter')}`);
    }

    oauthStateStore.delete(state); // Clean up used state
    const redirectUri = stateData.redirectUri;
    
    const clientId = process.env.QUICKBOOKS_CLIENT_ID;
    const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET;
    const environment = process.env.QUICKBOOKS_ENVIRONMENT || 'sandbox';
    
    const tokenUrl = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';

    // Exchange authorization code for tokens
    const tokenResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.json().catch(() => ({}));
      console.error('Token exchange error:', errorData);
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      return res.redirect(`${frontendUrl}/?oauth_error=${encodeURIComponent('Failed to exchange authorization code for tokens')}`);
    }

    const tokenData = await tokenResponse.json();

    // Store tokens with realmId
    if (realmId) {
      tokenStore.set(realmId, {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresAt: Date.now() + (tokenData.expires_in * 1000),
        refreshTokenExpiresAt: Date.now() + (tokenData.x_refresh_token_expires_in * 1000),
        realmId: realmId,
        environment: environment,
        updatedAt: Date.now()
      });
    }

    // Redirect to frontend with success
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    res.redirect(`${frontendUrl}/?oauth_success=true&realmId=${realmId || ''}`);
  } catch (error) {
    console.error('OAuth callback error:', error);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    res.redirect(`${frontendUrl}/?oauth_error=${encodeURIComponent('OAuth callback failed: ' + error.message)}`);
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  
  const statusCode = err.statusCode || 500;
  const message = process.env.NODE_ENV === 'production' 
    ? 'Internal Server Error' 
    : err.message;

  res.status(statusCode).json({
    success: false,
    error: message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found'
  });
});

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
  console.log(`🔧 Environment: ${process.env.NODE_ENV || 'development'}`);
  
  // Check if Gemini API key is configured
  const hasGeminiKey = !!(process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY);
  if (hasGeminiKey) {
    console.log('🤖 Gemini AI: ✅ API key configured');
  } else {
    console.log('🤖 Gemini AI: ❌ API key not found in environment variables');
    console.log('   Add GEMINI_API_KEY to your server/.env file');
  }
  
  // Check if QuickBooks OAuth is configured
  const hasQuickBooksOAuth = !!(process.env.QUICKBOOKS_CLIENT_ID && process.env.QUICKBOOKS_CLIENT_SECRET);
  if (hasQuickBooksOAuth) {
    console.log('🔐 QuickBooks OAuth: ✅ Client ID and Secret configured');
    console.log('   Environment:', process.env.QUICKBOOKS_ENVIRONMENT || 'sandbox (default)');
    console.log('   Redirect URI:', process.env.QUICKBOOKS_REDIRECT_URI || 'http://localhost:3001/api/oauth/callback (default)');
  } else {
    console.log('🔐 QuickBooks OAuth: ❌ Client ID or Secret not found');
    console.log('   Add QUICKBOOKS_CLIENT_ID and QUICKBOOKS_CLIENT_SECRET to your server/.env file');
    console.log('   Optional: QUICKBOOKS_REDIRECT_URI, QUICKBOOKS_ENVIRONMENT, QUICKBOOKS_SCOPE');
  }
});

// Handle server errors gracefully
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`❌ Port ${PORT} is already in use.`);
    console.error(`   Please either:`);
    console.error(`   1. Stop the process using port ${PORT}`);
    console.error(`   2. Set a different PORT in your .env file`);
    console.error(`   3. Run: lsof -ti:${PORT} | xargs kill -9`);
    process.exit(1);
  } else {
    console.error('❌ Server error:', err);
    process.exit(1);
  }
});

export default app;