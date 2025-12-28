import fetch from 'node-fetch';
import { tokenStore } from './tokenStore.js';

/**
 * Get access token for a realmId, with automatic refresh if needed
 * @param {string} realmId - The QuickBooks realm ID
 * @returns {Promise<{accessToken: string, realmId: string}>}
 */
export async function getAccessToken(realmId) {
  if (!realmId) {
    throw new Error('realmId is required');
  }

  let tokenData = tokenStore.get(realmId);

  if (!tokenData) {
    throw new Error('No OAuth tokens found for this realmId. Please connect your QuickBooks account via OAuth.');
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
      
      const tokenUrl = environment === 'production' 
        ? 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'
        : 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';

      const tokenResponse = await fetch(tokenUrl, {
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
        tokenData.isRefreshing = false;
        const errorData = await tokenResponse.json().catch(() => ({}));
        throw new Error(`Failed to refresh token: ${errorData.error || tokenResponse.statusText}`);
      }

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
    } catch (refreshError) {
      tokenData.isRefreshing = false;
      tokenStore.set(realmId, tokenData);
      throw refreshError;
    }
  }

  return {
    accessToken: tokenData.accessToken,
    realmId: tokenData.realmId
  };
}

/**
 * Middleware to automatically inject OAuth token when realmId is provided
 * If accessToken is already provided, it will be used instead
 */
export function injectOAuthToken(req, res, next) {
  const { realmId, accessToken } = req.body;

  // If accessToken is already provided, use it (for backward compatibility)
  if (accessToken) {
    return next();
  }

  // If realmId is provided but no accessToken, try to get OAuth token
  if (realmId && !accessToken) {
    getAccessToken(realmId)
      .then(({ accessToken: oauthToken }) => {
        req.body.accessToken = oauthToken;
        next();
      })
      .catch((error) => {
        res.status(401).json({
          success: false,
          error: error.message,
          requiresOAuth: true
        });
      });
  } else {
    next();
  }
}

