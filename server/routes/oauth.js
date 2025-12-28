import express from 'express';
import fetch from 'node-fetch';
import crypto from 'crypto';

const router = express.Router();

// OAuth configuration
const OAUTH_CONFIG = {
  sandbox: {
    authUrl: 'https://appcenter.intuit.com/connect/oauth2',
    tokenUrl: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
    revokeUrl: 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke',
  },
  production: {
    authUrl: 'https://appcenter.intuit.com/connect/oauth2',
    tokenUrl: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
    revokeUrl: 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke',
  }
};

import { tokenStore } from '../services/tokenStore.js';
import { oauthStateStore } from '../services/oauthStateStore.js';

/**
 * Generate authorization URL and redirect user to QuickBooks OAuth
 * GET /api/oauth/authorize
 */
router.get('/authorize', (req, res) => {
  try {
    const clientId = process.env.QUICKBOOKS_CLIENT_ID;
    const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET;
    const redirectUri = process.env.QUICKBOOKS_REDIRECT_URI || `${req.protocol}://${req.get('host')}/api/oauth/callback`;
    const environment = process.env.QUICKBOOKS_ENVIRONMENT || 'sandbox';
    const scope = process.env.QUICKBOOKS_SCOPE || 'com.intuit.quickbooks.accounting';

    if (!clientId || !clientSecret) {
      return res.status(500).json({
        success: false,
        error: 'QuickBooks OAuth credentials not configured. Please set QUICKBOOKS_CLIENT_ID and QUICKBOOKS_CLIENT_SECRET in your .env file.'
      });
    }

    // Generate state for CSRF protection
    const state = crypto.randomBytes(32).toString('hex');
    oauthStateStore.set(state, {
      createdAt: Date.now(),
      redirectUri
    });

    // Clean up old states (older than 10 minutes)
    const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
    for (const [key, value] of oauthStateStore.entries()) {
      if (value.createdAt < tenMinutesAgo) {
        oauthStateStore.delete(key);
      }
    }

    const config = OAUTH_CONFIG[environment] || OAUTH_CONFIG.sandbox;
    const authUrl = new URL(config.authUrl);
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', scope);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('state', state);

    res.json({
      success: true,
      authUrl: authUrl.toString(),
      state
    });
  } catch (error) {
    console.error('OAuth authorization error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate authorization URL: ' + error.message
    });
  }
});

/**
 * Handle OAuth callback from QuickBooks
 * GET /api/oauth/callback
 */
router.get('/callback', async (req, res) => {
  try {
    const { code, state, realmId, error } = req.query;

    if (error) {
      return res.redirect(`/?oauth_error=${encodeURIComponent(error)}`);
    }

    if (!code || !state) {
      return res.redirect(`/?oauth_error=${encodeURIComponent('Missing authorization code or state')}`);
    }

    // Verify state
    const stateData = oauthStateStore.get(state);
    if (!stateData) {
      return res.redirect(`/?oauth_error=${encodeURIComponent('Invalid or expired state parameter')}`);
    }

    oauthStateStore.delete(state); // Clean up used state

    const clientId = process.env.QUICKBOOKS_CLIENT_ID;
    const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET;
    const redirectUri = stateData.redirectUri;
    const environment = process.env.QUICKBOOKS_ENVIRONMENT || 'sandbox';
    const config = OAUTH_CONFIG[environment] || OAUTH_CONFIG.sandbox;

    // Exchange authorization code for tokens
    const tokenResponse = await fetch(config.tokenUrl, {
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
      return res.redirect(`/?oauth_error=${encodeURIComponent('Failed to exchange authorization code for tokens')}`);
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
    res.redirect(`/?oauth_error=${encodeURIComponent('OAuth callback failed: ' + error.message)}`);
  }
});

/**
 * Get current OAuth status
 * GET /api/oauth/status
 */
router.get('/status', (req, res) => {
  try {
    const { realmId } = req.query;

    if (!realmId) {
      return res.json({
        success: true,
        connected: false,
        message: 'No realmId provided'
      });
    }

    const tokenData = tokenStore.get(realmId);

    if (!tokenData) {
      return res.json({
        success: true,
        connected: false,
        message: 'No tokens found for this realmId'
      });
    }

    const isExpired = Date.now() >= tokenData.expiresAt;
    const needsRefresh = Date.now() >= (tokenData.expiresAt - 5 * 60 * 1000); // Refresh 5 minutes before expiry

    res.json({
      success: true,
      connected: true,
      realmId: tokenData.realmId,
      environment: tokenData.environment,
      expiresAt: tokenData.expiresAt,
      expiresIn: Math.max(0, Math.floor((tokenData.expiresAt - Date.now()) / 1000)),
      needsRefresh,
      isExpired
    });
  } catch (error) {
    console.error('OAuth status error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get OAuth status: ' + error.message
    });
  }
});

/**
 * Refresh access token
 * POST /api/oauth/refresh
 */
router.post('/refresh', async (req, res) => {
  try {
    const { realmId } = req.body;

    if (!realmId) {
      return res.status(400).json({
        success: false,
        error: 'realmId is required'
      });
    }

    const tokenData = tokenStore.get(realmId);

    if (!tokenData || !tokenData.refreshToken) {
      return res.status(404).json({
        success: false,
        error: 'No refresh token found for this realmId'
      });
    }

    // Check if refresh token is expired
    if (Date.now() >= tokenData.refreshTokenExpiresAt) {
      tokenStore.delete(realmId);
      return res.status(401).json({
        success: false,
        error: 'Refresh token has expired. Please reconnect your QuickBooks account.',
        requiresReconnect: true
      });
    }

    const clientId = process.env.QUICKBOOKS_CLIENT_ID;
    const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET;
    const environment = process.env.QUICKBOOKS_ENVIRONMENT || 'sandbox';
    const config = OAUTH_CONFIG[environment] || OAUTH_CONFIG.sandbox;

    // Refresh the token
    const tokenResponse = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: tokenData.refreshToken,
      }),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.json().catch(() => ({}));
      console.error('Token refresh error:', errorData);
      
      // If refresh fails, clear tokens
      tokenStore.delete(realmId);
      
      return res.status(tokenResponse.status).json({
        success: false,
        error: 'Failed to refresh token: ' + (errorData.error || tokenResponse.statusText),
        requiresReconnect: true
      });
    }

    const newTokenData = await tokenResponse.json();

    // Update stored tokens
    tokenStore.set(realmId, {
      accessToken: newTokenData.access_token,
      refreshToken: newTokenData.refresh_token || tokenData.refreshToken, // Use new refresh token if provided
      expiresAt: Date.now() + (newTokenData.expires_in * 1000),
      refreshTokenExpiresAt: newTokenData.x_refresh_token_expires_in 
        ? Date.now() + (newTokenData.x_refresh_token_expires_in * 1000)
        : tokenData.refreshTokenExpiresAt,
      realmId: realmId,
      environment: environment,
      updatedAt: Date.now()
    });

    res.json({
      success: true,
      message: 'Token refreshed successfully',
      expiresIn: newTokenData.expires_in
    });
  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to refresh token: ' + error.message
    });
  }
});

/**
 * Get access token for a realmId (with auto-refresh)
 * GET /api/oauth/token?realmId=xxx
 */
router.get('/token', async (req, res) => {
  try {
    const { realmId } = req.query;

    if (!realmId) {
      return res.status(400).json({
        success: false,
        error: 'realmId is required'
      });
    }

    let tokenData = tokenStore.get(realmId);

    if (!tokenData) {
      return res.status(404).json({
        success: false,
        error: 'No tokens found for this realmId. Please connect your QuickBooks account.',
        requiresAuth: true
      });
    }

    // Check if token needs refresh (within 5 minutes of expiry)
    const needsRefresh = Date.now() >= (tokenData.expiresAt - 5 * 60 * 1000);

    if (needsRefresh && !tokenData.isRefreshing) {
      // Mark as refreshing to prevent concurrent refresh requests
      tokenData.isRefreshing = true;
      tokenStore.set(realmId, tokenData);

      try {
        const clientId = process.env.QUICKBOOKS_CLIENT_ID;
        const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET;
        const environment = process.env.QUICKBOOKS_ENVIRONMENT || 'sandbox';
        const config = OAUTH_CONFIG[environment] || OAUTH_CONFIG.sandbox;

        const tokenResponse = await fetch(config.tokenUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
            'Accept': 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: tokenData.refreshToken,
          }),
        });

        if (tokenResponse.ok) {
          const newTokenData = await tokenResponse.json();
          tokenData = {
            accessToken: newTokenData.access_token,
            refreshToken: newTokenData.refresh_token || tokenData.refreshToken,
            expiresAt: Date.now() + (newTokenData.expires_in * 1000),
            refreshTokenExpiresAt: newTokenData.x_refresh_token_expires_in 
              ? Date.now() + (newTokenData.x_refresh_token_expires_in * 1000)
              : tokenData.refreshTokenExpiresAt,
            realmId: realmId,
            environment: environment,
            updatedAt: Date.now(),
            isRefreshing: false
          };
          tokenStore.set(realmId, tokenData);
        } else {
          tokenData.isRefreshing = false;
          // If refresh fails, return error
          return res.status(401).json({
            success: false,
            error: 'Failed to refresh token. Please reconnect your QuickBooks account.',
            requiresReconnect: true
          });
        }
      } catch (refreshError) {
        tokenData.isRefreshing = false;
        tokenStore.set(realmId, tokenData);
        throw refreshError;
      }
    }

    res.json({
      success: true,
      accessToken: tokenData.accessToken,
      realmId: tokenData.realmId,
      expiresAt: tokenData.expiresAt,
      expiresIn: Math.max(0, Math.floor((tokenData.expiresAt - Date.now()) / 1000))
    });
  } catch (error) {
    console.error('Get token error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get token: ' + error.message
    });
  }
});

/**
 * Revoke tokens (disconnect)
 * POST /api/oauth/revoke
 */
router.post('/revoke', async (req, res) => {
  try {
    const { realmId } = req.body;

    if (!realmId) {
      return res.status(400).json({
        success: false,
        error: 'realmId is required'
      });
    }

    const tokenData = tokenStore.get(realmId);

    if (!tokenData) {
      return res.json({
        success: true,
        message: 'No tokens found to revoke'
      });
    }

    const clientId = process.env.QUICKBOOKS_CLIENT_ID;
    const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET;
    const environment = process.env.QUICKBOOKS_ENVIRONMENT || 'sandbox';
    const config = OAUTH_CONFIG[environment] || OAUTH_CONFIG.sandbox;

    // Revoke the refresh token
    try {
      await fetch(config.revokeUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          token: tokenData.refreshToken
        }),
      });
    } catch (revokeError) {
      console.error('Revoke API call failed (continuing anyway):', revokeError);
    }

    // Remove from store
    tokenStore.delete(realmId);

    res.json({
      success: true,
      message: 'Tokens revoked successfully'
    });
  } catch (error) {
    console.error('Revoke token error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to revoke token: ' + error.message
    });
  }
});

export default router;

