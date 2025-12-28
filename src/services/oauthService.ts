import { apiClient } from './apiClient';

export interface OAuthStatus {
  success: boolean;
  connected: boolean;
  realmId?: string;
  environment?: string;
  expiresAt?: number;
  expiresIn?: number;
  needsRefresh?: boolean;
  isExpired?: boolean;
  message?: string;
}

export class OAuthService {
  /**
   * Get OAuth authorization URL
   */
  static async getAuthUrl(): Promise<{ success: boolean; authUrl?: string; error?: string }> {
    try {
      const response = await fetch('/api/oauth/authorize');
      
      if (!response.ok) {
        // Try to parse as JSON, but handle non-JSON responses
        let errorMessage = `HTTP error! status: ${response.status}`;
        try {
          const contentType = response.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) {
            const errorData = await response.json();
            errorMessage = errorData.error || errorMessage;
          } else {
            const text = await response.text();
            errorMessage = text || errorMessage;
          }
        } catch (e) {
          // If we can't parse the error, use the status text
          errorMessage = response.statusText || errorMessage;
        }
        
        return {
          success: false,
          error: errorMessage
        };
      }
      
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text();
        return {
          success: false,
          error: `Unexpected response format: ${text.substring(0, 100)}`
        };
      }
      
      const data = await response.json();
      return data;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get authorization URL'
      };
    }
  }

  /**
   * Get OAuth status for a realmId
   */
  static async getStatus(realmId: string): Promise<OAuthStatus> {
    try {
      const response = await fetch(`/api/oauth/status?realmId=${encodeURIComponent(realmId)}`);
      const data = await response.json();
      return data;
    } catch (error) {
      return {
        success: false,
        connected: false,
        message: error instanceof Error ? error.message : 'Failed to get OAuth status'
      };
    }
  }

  /**
   * Refresh OAuth token
   */
  static async refreshToken(realmId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await fetch('/api/oauth/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ realmId }),
      });
      const data = await response.json();
      return data;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to refresh token'
      };
    }
  }

  /**
   * Revoke OAuth tokens (disconnect)
   */
  static async revokeToken(realmId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await fetch('/api/oauth/revoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ realmId }),
      });
      const data = await response.json();
      return data;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to revoke token'
      };
    }
  }

  /**
   * Get access token (with auto-refresh)
   */
  static async getAccessToken(realmId: string): Promise<{ success: boolean; accessToken?: string; error?: string; requiresReconnect?: boolean }> {
    try {
      const response = await fetch(`/api/oauth/token?realmId=${encodeURIComponent(realmId)}`);
      const data = await response.json();
      return data;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get access token'
      };
    }
  }

  /**
   * Initiate OAuth flow by opening authorization URL
   */
  static async initiateAuth(): Promise<void> {
    const { authUrl, error } = await this.getAuthUrl();
    
    if (error || !authUrl) {
      throw new Error(error || 'Failed to get authorization URL');
    }

    // Open OAuth URL in a new window
    window.location.href = authUrl;
  }
}

